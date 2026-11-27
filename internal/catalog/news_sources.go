package catalog

// NewsSource describes a publisher feed, independent of model-generated labels.
type NewsSource struct {
	Format     string `json:"format,omitempty"`
	Transport  string `json:"transport,omitempty"`
	ID         string `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	Channel    string `json:"channel"`
	Disabled   bool   `json:"disabled,omitempty"`
	MaxAgeDays int    `json:"max_age_days,omitempty"` // 0 defaults to 14; -1 explicitly backfills all dates.
}

var NewsSources = []NewsSource{
	{ID: "thehackernews", Name: "The Hacker News", URL: "https://feeds.feedburner.com/TheHackersNews", Channel: "security"},
	{ID: "krebs", Name: "Krebs on Security", URL: "https://krebsonsecurity.com/feed/", Channel: "security"},
	{ID: "openai", Name: "OpenAI News", URL: "https://openai.com/news/rss.xml", Channel: "ai"},
	{ID: "huggingface", Name: "Hugging Face Blog", URL: "https://huggingface.co/blog/feed.xml", Channel: "ai"},
	{ID: "arxiv_cs_cr", Name: "arXiv cs.CR", URL: "https://rss.arxiv.org/atom/cs.cr", Channel: "arxiv"},
	{ID: "arxiv_cs_ai", Name: "arXiv cs.AI + cs.CL", URL: "https://rss.arxiv.org/atom/cs.ai+cs.cl", Channel: "arxiv"},
	{ID: "arxiv_cs_se", Name: "arXiv cs.SE", URL: "https://rss.arxiv.org/atom/cs.se", Channel: "arxiv"},
}

func FindNewsSource(source string) (NewsSource, bool) {
	for _, item := range NewsSources {
		if source == item.ID || source == item.URL {
			return item, true
		}
	}
	return NewsSource{}, false
}

func ValidNewsChannel(channel string) bool {
	return channel == "news" || channel == "security" || channel == "ai" || channel == "arxiv"
}

func NewsChannel(row map[string]any) string {
	// Preserve the classification of archived records from retired subscriptions.
	if source := Str(row, "source"); source == "bleepingcomputer" || source == "https://www.bleepingcomputer.com/feed/" || source == "securityweek" || source == "https://www.securityweek.com/feed/" {
		return "security"
	}
	if IsArxivSource(Str(row, "source")) {
		return "arxiv"
	}
	if channel := Str(row, "channel"); ValidNewsChannel(channel) {
		return channel
	}
	if source, ok := FindNewsSource(Str(row, "source")); ok {
		return source.Channel
	}
	return "news"
}

func NewsChannelName(channel string) string {
	switch channel {
	case "security":
		return "安全资讯"
	case "ai":
		return "AI 资讯"
	case "arxiv":
		return "arXiv 研究"
	default:
		return "综合新闻"
	}
}
