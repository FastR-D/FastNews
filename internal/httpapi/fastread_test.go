package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func integrationRequest(t *testing.T, h *harness, method, token string, body any) (int, map[string]any) {
	t.Helper()
	var data bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&data).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	request, err := http.NewRequest(method, h.http.URL+"/api/integrations/fastread/directions", &data)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if err = json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, result
}
func TestFastReadPairingScopesDirectionsAndRevokes(t *testing.T) {
	h := fixture(t)
	h.login(t, "reader-one@example.org")
	status, _, _ := h.request(t, "POST", "/api/integrations/fastread/token", map[string]any{}, "", true)
	if status != 403 {
		t.Fatal("missing CSRF accepted", status)
	}
	status, created, _ := h.request(t, "POST", "/api/integrations/fastread/token", map[string]any{}, h.csrf, true)
	if status != 201 {
		t.Fatal(status, created)
	}
	token := created["token"].(string)
	status, public, _ := h.request(t, "GET", "/api/integrations/fastread/token", nil, "", true)
	if status != 200 || public["connected"] != true || public["token"] != nil {
		t.Fatal("status leaked token", public)
	}
	var stored string
	if err := h.app.Store.DB.QueryRow("SELECT token_hash FROM fastread_connections").Scan(&stored); err != nil || stored == token || strings.Contains(stored, "frn_") {
		t.Fatal("plaintext token stored", err)
	}
	if status, _ = integrationRequest(t, h, "PUT", "", map[string]string{"text": "unauthorized", "mode": "replace"}); status != 401 {
		t.Fatal("anonymous mutation accepted", status)
	}
	if status, _ = integrationRequest(t, h, "PUT", token, map[string]string{"text": "Efficient document retrieval", "mode": "replace"}); status != 200 {
		t.Fatal(status)
	}
	status, value := integrationRequest(t, h, "PUT", token, map[string]string{"text": "Page-grounded model reasoning", "mode": "append"})
	if status != 200 || value["text"] != "Efficient document retrieval\n\nPage-grounded model reasoning" {
		t.Fatal(status, value)
	}
	status, value, _ = h.request(t, "GET", "/api/content/impression", nil, "", true)
	if status != 200 || !strings.Contains(value["impression"].(map[string]any)["text"].(string), "Page-grounded") {
		t.Fatal("direction was not written to personal impression", value)
	}
	aliceCookie, aliceCSRF := h.cookie, h.csrf
	h.login(t, "reader-two@example.org")
	status, value, _ = h.request(t, "GET", "/api/content/impression", nil, "", true)
	if status != 200 || value["impression"].(map[string]any)["text"] != "" {
		t.Fatal("other user impression modified", value)
	}
	status, value = integrationRequest(t, h, "GET", token, nil)
	if status != 200 || !strings.Contains(value["text"].(string), "Efficient") {
		t.Fatal("bearer token changed owner", value)
	}
	h.cookie, h.csrf = aliceCookie, aliceCSRF
	status, replaced, _ := h.request(t, "POST", "/api/integrations/fastread/token", map[string]any{}, h.csrf, true)
	if status != 201 {
		t.Fatal(status, replaced)
	}
	if status, _ = integrationRequest(t, h, "GET", token, nil); status != 401 {
		t.Fatal("rotated token remains valid", status)
	}
	token = replaced["token"].(string)
	status, _, _ = h.request(t, "DELETE", "/api/integrations/fastread/token", nil, h.csrf, true)
	if status != 200 {
		t.Fatal(status)
	}
	if status, _ = integrationRequest(t, h, "GET", token, nil); status != 401 {
		t.Fatal("revoked token remains valid", status)
	}
}
func TestFastReadDirectionsRespectImpressionLengthAndAccountStatus(t *testing.T) {
	h := fixture(t)
	h.login(t, "limits@example.org")
	_, created, _ := h.request(t, "POST", "/api/integrations/fastread/token", map[string]any{}, h.csrf, true)
	token := created["token"].(string)
	if status, _ := integrationRequest(t, h, "PUT", token, map[string]string{"text": strings.Repeat("研", 4000), "mode": "replace"}); status != 200 {
		t.Fatal(status)
	}
	if status, _ := integrationRequest(t, h, "PUT", token, map[string]string{"text": "more", "mode": "append"}); status != 413 {
		t.Fatal("oversize append accepted", status)
	}
	status, value := integrationRequest(t, h, "GET", token, nil)
	if status != 200 || len([]rune(value["text"].(string))) != 4000 {
		t.Fatal("failed append altered stored text")
	}
	if _, err := h.app.Store.DB.Exec("UPDATE users SET status='disabled' WHERE email='limits@example.org'"); err != nil {
		t.Fatal(err)
	}
	if status, _ := integrationRequest(t, h, "GET", token, nil); status != 401 {
		t.Fatal("disabled account token accepted", status)
	}
}
