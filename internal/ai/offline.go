package ai

import (
	"fmt"
	"github.com/FastR-D/FastNews/internal/catalog"
	"sort"
	"strings"
)

// OfflineReview organizes source evidence without pretending it is a generated
// synthesis. This preserves browsing when LLM credentials are absent or offline.
func OfflineReview(query string, evidence []catalog.Paper) map[string]any {
	groups := map[string][]catalog.Paper{}
	for _, p := range evidence {
		groups[p.Category] = append(groups[p.Category], p)
	}
	names := []string{}
	for name := range groups {
		names = append(names, name)
	}
	sort.Strings(names)
	categories := []map[string]any{}
	for _, name := range names {
		ids := []string{}
		lines := []string{}
		for _, p := range groups[name] {
			ids = append(ids, p.ID)
			lines = append(lines, fmt.Sprintf("《%s》：%s", p.Title, p.Summary))
		}
		categories = append(categories, map[string]any{"name": name, "consensus": "以下按已有分类整理候选证据，尚未进行跨论文共识判断。", "developments": strings.Join(lines, "\n\n"), "gaps": "需要结合原文比较各研究的假设、方法与实验边界。", "paper_ids": ids})
	}
	return map[string]any{"field_zh": query, "scope": fmt.Sprintf("基于本地语料向量召回的 %d 篇候选，按已有研究类别整理。", len(evidence)), "categories": categories, "gaps": "离线证据不能直接证明领域共识或研究空白。", "limitations": "这是一份本地证据索引。配置 LLM 后可生成完整分类综述；摘要与原文仍需交叉核对。"}
}
func OfflineBrief(query string, papers []catalog.Paper) map[string]any {
	stats := Statistics(papers)
	cats := stats["by_category"].([]Count)
	confs := stats["by_conference"].([]Count)
	years := stats["by_year"].([]Count)
	findings := []map[string]string{}
	if len(cats) > 0 {
		findings = append(findings, map[string]string{"title": "样本最多的研究类别", "body": fmt.Sprintf("%s：%d 篇，占样本 %.1f%%。", cats[0].Label, cats[0].Count, cats[0].Pct)})
	}
	if len(confs) > 0 {
		findings = append(findings, map[string]string{"title": "样本最多的会场", "body": fmt.Sprintf("%s：%d 篇，占样本 %.1f%%。", confs[0].Label, confs[0].Count, confs[0].Pct)})
	}
	if len(years) > 0 {
		findings = append(findings, map[string]string{"title": "年份覆盖", "body": fmt.Sprintf("本地样本覆盖 %s，共 %d 个年份。", stats["year_span"], len(years))})
	}
	return map[string]any{"title": query, "kicker": "FastNews · 本地统计简报", "hook": fmt.Sprintf("%d 篇本地样本的会场、年份与类别分布", len(papers)), "subtitle": "基于实际语料统计，未调用 LLM。", "lead": "以下数字来自当前语料与筛选样本，不能外推为全部会议的研究分布。", "findings": findings, "method": "全景模式统计全部符合条件的本地顶会摘要；主题模式统计向量召回样本。引用次数与奖项仅使用已记录的元数据。", "questions": []any{}, "limitations": "本地摘要覆盖不等于完整录用列表；向量召回与类别标签存在偏差。", "discussion": []map[string]string{{"title": "进一步分析", "body": "配置 LLM 后可基于同一统计口径生成对照问答与更完整的讨论。"}}}
}
