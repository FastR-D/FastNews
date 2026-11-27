package catalog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestReportReaderOnlyLoadsCataloguedDocumentData(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "top-conf/data/report")
	os.MkdirAll(dir, 0755)
	content := []ReportNode{{Tag: "h2", Children: []ReportNode{{Text: "Research"}}}, {Tag: "article", Children: []ReportNode{{Tag: "p", Children: []ReportNode{{Text: "A useful result."}}}}}}
	b, _ := json.Marshal(content)
	os.WriteFile(filepath.Join(dir, "CCS_2026_Report.json"), b, 0644)
	c := &Catalog{Root: root}
	result, err := c.ReadReport("top-conf/data/report/CCS_2026_Report.json")
	if err != nil || len(result.Content) != 2 {
		t.Fatal(result, err)
	}
	for _, path := range []string{"../../etc/passwd", "top-conf/data/report/../secret.json", "missing.html"} {
		if _, err := c.ReadReport(path); err == nil {
			t.Fatal("unlisted report accepted", path)
		}
	}
	os.WriteFile(filepath.Join(dir, "CCS_2026_Report.json"), []byte("invalid"), 0644)
	if _, err := c.ReadReport("top-conf/data/report/CCS_2026_Report.json"); err == nil {
		t.Fatal("invalid document accepted")
	}
}
func TestResearchNewsExcludesGeneralPublishers(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "secnews/data/articles")
	os.MkdirAll(dir, 0755)
	os.WriteFile(filepath.Join(dir, "2026-11-27.jsonl"), []byte("{\"source\":\"bbc_world\",\"_id\":\"b\"}\n{\"source\":\"hackernews\",\"_id\":\"h\"}\n{\"source\":\"openai\",\"_id\":\"a\"}\n"), 0644)
	rows, err := (&Catalog{Root: root}).News("2026-11-27")
	if err != nil || len(rows) != 1 || Str(rows[0], "source") != "openai" {
		t.Fatal(rows, err)
	}
}
