package httpapi

// Curated collection plans use verified published years. Adding a conference
// here exposes it to both manual runs and the existing persistent scheduler.
type paperCollection struct {
	ID, Name, Domain, Conference, Provider string
	Year                                   int
}

func paperCollections() []paperCollection {
	return []paperCollection{
		{"paper-icse-2026", "ICSE 2026 · 官方研究轨道", "software", "icse", "researchr", 2026},
		{"paper-fse-2026", "FSE 2026 · 官方研究轨道", "software", "fse", "researchr", 2026},
		{"paper-ase-2025", "ASE 2025 · DBLP", "software", "ase", "dblp", 2025},
		{"paper-issta-2025", "ISSTA 2025 · DBLP", "software", "issta", "dblp", 2025},
		{"paper-iclr-2025", "ICLR 2025 · 官方论文集", "ml", "iclr", "iclr-proceedings", 2025},
		{"paper-icml-2025", "ICML 2025 · PMLR", "ml", "icml", "pmlr", 2025},
		{"paper-neurips-2025", "NeurIPS 2025 · 主会论文集", "ml", "neurips", "neurips-proceedings", 2025},
	}
}
