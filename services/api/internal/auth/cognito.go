// Package auth verifies AWS Cognito JWTs (access or id tokens) without any
// AWS SDK dependency. It fetches the user pool's JWKS over HTTPS, validates the
// RS256 signature, and checks the standard claims (iss, exp, token_use, and the
// audience/client_id), extracting `sub` as the owner user id.
//
// Dependency note: this adds github.com/golang-jwt/jwt/v5 (a small, widely-used,
// pure-Go JWT library). JWKS fetching + RSA key assembly is done with the
// standard library only, so no extra "jwks" dependency is pulled in.
package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenUse selects which Cognito token kind is expected. Cognito access tokens
// carry `token_use: "access"` and a `client_id` claim; id tokens carry
// `token_use: "id"` and an `aud` claim equal to the app client id. We accept
// either by checking the matching claim against the configured client id.
const (
	tokenUseAccess = "access"
	tokenUseID     = "id"
)

// Verifier validates Cognito JWTs against a user pool's issuer and JWKS.
type Verifier struct {
	// Issuer is the expected `iss` claim, e.g.
	// https://cognito-idp.<region>.amazonaws.com/<userPoolId>.
	Issuer string
	// ClientID is the Cognito app client id. For id tokens it must equal `aud`;
	// for access tokens it must equal `client_id`.
	ClientID string

	keys *jwksCache
}

// Config configures a Verifier. JWKSURL defaults to <Issuer>/.well-known/jwks.json
// when empty (the standard Cognito location).
type Config struct {
	Issuer   string
	ClientID string
	JWKSURL  string
	// HTTPClient is used to fetch the JWKS; defaults to a 10s-timeout client.
	HTTPClient *http.Client
}

// NewVerifier builds a Verifier from config. It does not fetch the JWKS yet;
// keys are fetched lazily on first verification and cached.
func NewVerifier(cfg Config) (*Verifier, error) {
	if cfg.Issuer == "" {
		return nil, errors.New("auth: issuer is required")
	}
	if cfg.ClientID == "" {
		return nil, errors.New("auth: client id is required")
	}
	jwksURL := cfg.JWKSURL
	if jwksURL == "" {
		jwksURL = cfg.Issuer + "/.well-known/jwks.json"
	}
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Verifier{
		Issuer:   cfg.Issuer,
		ClientID: cfg.ClientID,
		keys:     &jwksCache{url: jwksURL, httpClient: httpClient},
	}, nil
}

// Verify parses and validates a raw JWT string, returning the `sub` claim (the
// stable Cognito user id) on success.
func (v *Verifier) Verify(ctx context.Context, raw string) (string, error) {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(v.Issuer),
		jwt.WithExpirationRequired(),
	)

	claims := jwt.MapClaims{}
	_, err := parser.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("auth: token missing kid")
		}
		key, err := v.keys.key(ctx, kid)
		if err != nil {
			return nil, err
		}
		return key, nil
	})
	if err != nil {
		return "", fmt.Errorf("auth: token validation failed: %w", err)
	}

	// token_use + audience: Cognito access tokens use `client_id`, id tokens use
	// `aud`. Require the configured client id to match the appropriate claim.
	use, _ := claims["token_use"].(string)
	switch use {
	case tokenUseAccess:
		if cid, _ := claims["client_id"].(string); cid != v.ClientID {
			return "", errors.New("auth: client_id does not match")
		}
	case tokenUseID:
		if !audienceMatches(claims["aud"], v.ClientID) {
			return "", errors.New("auth: aud does not match client id")
		}
	default:
		return "", fmt.Errorf("auth: unexpected token_use %q", use)
	}

	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", errors.New("auth: token missing sub")
	}
	return sub, nil
}

// audienceMatches handles `aud` being either a string or a list of strings.
func audienceMatches(aud interface{}, want string) bool {
	switch a := aud.(type) {
	case string:
		return a == want
	case []interface{}:
		for _, item := range a {
			if s, ok := item.(string); ok && s == want {
				return true
			}
		}
	case []string:
		for _, s := range a {
			if s == want {
				return true
			}
		}
	}
	return false
}

// jwksCache lazily fetches and caches a JWKS keyed by kid. Cognito rotates keys
// rarely; on a kid miss we refetch once to pick up newly-rotated keys.
type jwksCache struct {
	url        string
	httpClient *http.Client

	mu   sync.RWMutex
	keys map[string]*rsa.PublicKey
}

func (c *jwksCache) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	c.mu.RLock()
	if k, ok := c.keys[kid]; ok {
		c.mu.RUnlock()
		return k, nil
	}
	c.mu.RUnlock()

	if err := c.refresh(ctx); err != nil {
		return nil, err
	}

	c.mu.RLock()
	defer c.mu.RUnlock()
	if k, ok := c.keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("auth: no JWKS key for kid %q", kid)
}

// jwk is a single JSON Web Key (RSA only, as used by Cognito).
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func (c *jwksCache) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return fmt.Errorf("auth: build JWKS request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("auth: fetch JWKS: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("auth: JWKS endpoint returned %d", resp.StatusCode)
	}

	var doc struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return fmt.Errorf("auth: decode JWKS: %w", err)
	}

	parsed := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" {
			continue
		}
		pub, err := rsaPublicKey(k.N, k.E)
		if err != nil {
			return fmt.Errorf("auth: parse JWKS key %q: %w", k.Kid, err)
		}
		parsed[k.Kid] = pub
	}

	c.mu.Lock()
	c.keys = parsed
	c.mu.Unlock()
	return nil
}

// rsaPublicKey reconstructs an RSA public key from base64url-encoded modulus and
// exponent (the JWK `n` and `e` parameters).
func rsaPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, fmt.Errorf("decode modulus: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, fmt.Errorf("decode exponent: %w", err)
	}

	// Left-pad the exponent to 8 bytes so it can be read as a uint64.
	if len(eBytes) > 8 {
		return nil, errors.New("exponent too large")
	}
	var eBuf [8]byte
	copy(eBuf[8-len(eBytes):], eBytes)
	e := binary.BigEndian.Uint64(eBuf[:])
	if e == 0 {
		return nil, errors.New("zero exponent")
	}

	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(e),
	}, nil
}
