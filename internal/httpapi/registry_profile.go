package httpapi

import (
	"encoding/json"
	"fmt"
	"github.com/FastR-D/FastNews/internal/catalog"
	"github.com/FastR-D/FastNews/internal/store"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var orcidID = regexp.MustCompile(`^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$`)
var rorID = regexp.MustCompile(`^0[0-9a-hj-km-np-tv-z]{6}[0-9]{2}$`)

func (s *Server) registryProfile(w http.ResponseWriter, r *http.Request, u *url.URL, client *http.Client) (bool, error) {
	id := strings.Trim(u.Path, "/")
	endpoint, provider := "", ""
	switch strings.ToLower(u.Hostname()) {
	case "orcid.org", "www.orcid.org":
		if !orcidID.MatchString(id) {
			return true, store.Fail(400, "请填写完整的 ORCID 个人记录链接")
		}
		provider = "ORCID"
		endpoint = "https://pub.orcid.org/v3.0/" + id + "/person"
	case "ror.org", "www.ror.org":
		if !rorID.MatchString(id) {
			return true, store.Fail(400, "请填写完整的 ROR 机构记录链接")
		}
		provider = "ROR"
		endpoint = "https://api.ror.org/v2/organizations/" + id
	default:
		return false, nil
	}
	req, err := http.NewRequestWithContext(r.Context(), "GET", endpoint, nil)
	if err != nil {
		return true, err
	}
	req.Header.Set("Accept", "application/json")
	if provider == "ORCID" && s.Config.ORCIDToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.Config.ORCIDToken)
	}
	// Registry tokens must never follow a redirect, including same-domain redirects.
	registryClient := *client
	registryClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := registryClient.Do(req)
	if err != nil {
		return true, store.Fail(502, provider+" 暂时无法连接")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 || resp.StatusCode == 429 {
		return true, store.Fail(502, provider+" 访问受限，请稍后重试或配置公共读取凭据")
	}
	if resp.StatusCode != 200 {
		return true, store.Fail(502, provider+" 未返回可用公开记录")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	if err != nil {
		return true, err
	}
	if len(raw) > 2<<20 {
		return true, store.Fail(413, "公开记录过大")
	}
	result, err := parseRegistryProfile(provider, raw)
	if err != nil {
		return true, store.Fail(502, "公开记录格式无法识别")
	}
	result["source"], result["fetchedAt"] = u.String(), time.Now().UTC().Format(time.RFC3339)
	reply(w, r, 200, result)
	return true, nil
}
func parseRegistryProfile(provider string, raw []byte) (map[string]any, error) {
	profiles := []map[string]string{}
	title, description := "", ""
	if provider == "ORCID" {
		var v struct {
			Name struct {
				Given struct {
					Value string `json:"value"`
				} `json:"given-names"`
				Family struct {
					Value string `json:"value"`
				} `json:"family-name"`
				Credit struct {
					Value string `json:"value"`
				} `json:"credit-name"`
			} `json:"name"`
			Biography struct {
				Content string `json:"content"`
			} `json:"biography"`
			URLs struct {
				Items []struct {
					Name string `json:"url-name"`
					URL  struct {
						Value string `json:"value"`
					} `json:"url"`
				} `json:"researcher-url"`
			} `json:"researcher-urls"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		title = catalog.First(v.Name.Credit.Value, strings.TrimSpace(v.Name.Given.Value+" "+v.Name.Family.Value))
		description = v.Biography.Content
		for _, link := range v.URLs.Items {
			profiles = append(profiles, map[string]string{"title": catalog.First(link.Name, "主页"), "url": link.URL.Value})
		}
	} else {
		var v struct {
			Names []struct {
				Value string   `json:"value"`
				Types []string `json:"types"`
			} `json:"names"`
			Links []struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			} `json:"links"`
			Types       []string `json:"types"`
			Status      string   `json:"status"`
			Established *int     `json:"established"`
			Locations   []struct {
				Details struct{ Name, CountryName string } `json:"-"`
				Geo     struct {
					Name    string `json:"name"`
					Country string `json:"country_name"`
				} `json:"geonames_details"`
			} `json:"locations"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		for _, name := range v.Names {
			if title == "" {
				title = name.Value
			}
			for _, kind := range name.Types {
				if kind == "ror_display" {
					title = name.Value
				}
			}
		}
		parts := []string{}
		if len(v.Types) > 0 {
			parts = append(parts, strings.Join(v.Types, " / "))
		}
		for _, loc := range v.Locations {
			parts = append(parts, strings.TrimSpace(loc.Geo.Name+", "+loc.Geo.Country))
		}
		if v.Established != nil {
			parts = append(parts, fmt.Sprintf("成立于 %d 年", *v.Established))
		}
		if v.Status != "" {
			parts = append(parts, "ROR 状态："+v.Status)
		}
		description = strings.Join(parts, " · ")
		for _, link := range v.Links {
			profiles = append(profiles, map[string]string{"title": link.Type, "url": link.Value})
		}
	}
	if title == "" {
		return nil, fmt.Errorf("registry record has no name")
	}
	return map[string]any{"title": title, "description": catalog.Clip(description, 2400), "profiles": profiles, "papers": []any{}, "provider": provider}, nil
}
