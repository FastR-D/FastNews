package catalog

import (
	"reflect"
	"testing"
)

func TestParenthesizedAuthorsKeepNamesAndInstitutionsSeparate(t *testing.T) {
	tests := []struct {
		name, input  string
		names, units []string
	}{
		{"CCS IPv6", "Hugo Hue (Georgia Institute of Technology), Abhishek Bhaskar (Georgia Institute of Technology), Amanda Hsu (Georgia Institute of Technology), Paul Pearce (University of California, Irvine), Frank Li (Georgia Institute of Technology)", []string{"Hugo Hue", "Abhishek Bhaskar", "Amanda Hsu", "Paul Pearce", "Frank Li"}, []string{"Georgia Institute of Technology", "Georgia Institute of Technology", "Georgia Institute of Technology", "University of California, Irvine", "Georgia Institute of Technology"}},
		{"CCS DNS", "Shiming Liu (Tsinghua University, BNRist), Yunyi Zhang (Tsinghua University), Ruixuan Li (Tsinghua University), Shiyao Guo (Tsinghua University), Baojun Liu (Tsinghua University), Donghong Sun (Tsinghua University), Yong Ma (Alibaba Cloud), Linjian Song (Alibaba Cloud)", []string{"Shiming Liu", "Yunyi Zhang", "Ruixuan Li", "Shiyao Guo", "Baojun Liu", "Donghong Sun", "Yong Ma", "Linjian Song"}, []string{"Tsinghua University, BNRist", "Tsinghua University", "Tsinghua University", "Tsinghua University", "Tsinghua University", "Tsinghua University", "Alibaba Cloud", "Alibaba Cloud"}},
		{"nested and full width", "张三（示例大学（北京），实验室）；Alice (Institute of Science and Technology), and Bob (Example University)", []string{"张三", "Alice", "Bob"}, []string{"示例大学（北京），实验室", "Institute of Science and Technology", "Example University"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			people := SplitAuthors(tt.input)
			names, units := []string{}, []string{}
			for _, person := range people {
				names = append(names, person.Name)
				if len(person.Affiliations) != 1 {
					t.Fatalf("unexpected affiliations: %#v", person)
				}
				units = append(units, person.Affiliations[0].Name)
			}
			if !reflect.DeepEqual(names, tt.names) || !reflect.DeepEqual(units, tt.units) {
				t.Fatalf("names=%v units=%v", names, units)
			}
		})
	}
}

func TestAffiliationGroupsAndMalformedInput(t *testing.T) {
	people := SplitAuthors("Alice (Example University; Example Lab) and Bob")
	if len(people) != 2 || people[0].Name != "Alice" || len(people[0].Affiliations) != 2 || people[1].Name != "Bob" {
		t.Fatal(people)
	}
	malformed := "Alice (Example University, Bob"
	people = SplitAuthors(malformed)
	if len(people) != 1 || people[0].Name != malformed || len(people[0].Affiliations) != 0 {
		t.Fatal("invented entities from incomplete affiliation", people)
	}
	paper := Paper{Author: "Hugo Hue (Georgia Institute of Technology), Frank Li (Georgia Institute of Technology)"}
	DecoratePaper(&paper, nil)
	if len(paper.AuthorsList) != 2 || len(paper.Institutions) != 1 || paper.Institutions[0].Name != "Georgia Institute of Technology" {
		t.Fatal(paper)
	}
}

func TestSharedInstitutionDoesNotBecomeAuthor(t *testing.T) {
	people := SplitAuthors("Nurullah Erinola, Marcel Maehren, Marcus Brinkmann, and Jörg Schwenk, Ruhr University Bochum")
	if len(people) != 4 {
		t.Fatal(people)
	}
	for _, person := range people {
		if len(person.Affiliations) != 1 || person.Affiliations[0].Name != "Ruhr University Bochum" {
			t.Fatal(person)
		}
	}
	if people[3].Name != "Jörg Schwenk" {
		t.Fatal(people)
	}
}
