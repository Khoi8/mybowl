package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	testIssuer   = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL"
	testClientID = "test-app-client-id"
	testKid      = "test-key-1"
)

// jwksServer spins up an httptest server publishing a JWKS for the given key,
// mimicking Cognito's /.well-known/jwks.json endpoint.
func jwksServer(t *testing.T, kid string, pub *rsa.PublicKey) *httptest.Server {
	t.Helper()

	eBuf := make([]byte, 8)
	binary.BigEndian.PutUint64(eBuf, uint64(pub.E))
	// Trim leading zero bytes from the exponent.
	i := 0
	for i < len(eBuf)-1 && eBuf[i] == 0 {
		i++
	}

	doc := map[string]any{
		"keys": []map[string]string{
			{
				"kty": "RSA",
				"kid": kid,
				"use": "sig",
				"alg": "RS256",
				"n":   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
				"e":   base64.RawURLEncoding.EncodeToString(eBuf[i:]),
			},
		},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(doc)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func signToken(t *testing.T, key *rsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	signed, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func newVerifier(t *testing.T, jwksURL string) *Verifier {
	t.Helper()
	v, err := NewVerifier(Config{
		Issuer:   testIssuer,
		ClientID: testClientID,
		JWKSURL:  jwksURL,
	})
	if err != nil {
		t.Fatalf("NewVerifier: %v", err)
	}
	return v
}

func baseAccessClaims() jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{
		"sub":       "user-sub-123",
		"iss":       testIssuer,
		"token_use": tokenUseAccess,
		"client_id": testClientID,
		"exp":       now.Add(time.Hour).Unix(),
		"iat":       now.Unix(),
	}
}

func TestVerify_ValidAccessToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	srv := jwksServer(t, testKid, &key.PublicKey)
	v := newVerifier(t, srv.URL)

	token := signToken(t, key, testKid, baseAccessClaims())
	sub, err := v.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("expected valid token, got error: %v", err)
	}
	if sub != "user-sub-123" {
		t.Fatalf("sub = %q, want user-sub-123", sub)
	}
}

func TestVerify_ValidIDToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	srv := jwksServer(t, testKid, &key.PublicKey)
	v := newVerifier(t, srv.URL)

	claims := baseAccessClaims()
	claims["token_use"] = tokenUseID
	delete(claims, "client_id")
	claims["aud"] = testClientID

	token := signToken(t, key, testKid, claims)
	sub, err := v.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("expected valid id token, got error: %v", err)
	}
	if sub != "user-sub-123" {
		t.Fatalf("sub = %q, want user-sub-123", sub)
	}
}

func TestVerify_Expired(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := jwksServer(t, testKid, &key.PublicKey)
	v := newVerifier(t, srv.URL)

	claims := baseAccessClaims()
	claims["exp"] = time.Now().Add(-time.Hour).Unix()
	claims["iat"] = time.Now().Add(-2 * time.Hour).Unix()

	token := signToken(t, key, testKid, claims)
	if _, err := v.Verify(context.Background(), token); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}

func TestVerify_WrongIssuer(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := jwksServer(t, testKid, &key.PublicKey)
	v := newVerifier(t, srv.URL)

	claims := baseAccessClaims()
	claims["iss"] = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EVILPOOL"

	token := signToken(t, key, testKid, claims)
	if _, err := v.Verify(context.Background(), token); err == nil {
		t.Fatal("expected wrong issuer to be rejected")
	}
}

func TestVerify_WrongAudience(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := jwksServer(t, testKid, &key.PublicKey)
	v := newVerifier(t, srv.URL)

	claims := baseAccessClaims()
	claims["client_id"] = "some-other-client"

	token := signToken(t, key, testKid, claims)
	if _, err := v.Verify(context.Background(), token); err == nil {
		t.Fatal("expected wrong client_id to be rejected")
	}
}

func TestVerify_BadSignature(t *testing.T) {
	signingKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	// JWKS publishes a *different* key than the one used to sign.
	publishedKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := jwksServer(t, testKid, &publishedKey.PublicKey)
	v := newVerifier(t, srv.URL)

	token := signToken(t, signingKey, testKid, baseAccessClaims())
	if _, err := v.Verify(context.Background(), token); err == nil {
		t.Fatal("expected bad signature to be rejected")
	}
}

func TestVerify_UnknownKid(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := jwksServer(t, testKid, &key.PublicKey)
	v := newVerifier(t, srv.URL)

	token := signToken(t, key, "some-other-kid", baseAccessClaims())
	if _, err := v.Verify(context.Background(), token); err == nil {
		t.Fatal("expected unknown kid to be rejected")
	}
}

func TestVerify_MissingTokenUse(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	srv := jwksServer(t, testKid, &key.PublicKey)
	v := newVerifier(t, srv.URL)

	claims := baseAccessClaims()
	delete(claims, "token_use")

	token := signToken(t, key, testKid, claims)
	if _, err := v.Verify(context.Background(), token); err == nil {
		t.Fatal("expected missing token_use to be rejected")
	}
}

func TestNewVerifier_Validation(t *testing.T) {
	if _, err := NewVerifier(Config{ClientID: "x"}); err == nil {
		t.Fatal("expected error for missing issuer")
	}
	if _, err := NewVerifier(Config{Issuer: "x"}); err == nil {
		t.Fatal("expected error for missing client id")
	}
}
