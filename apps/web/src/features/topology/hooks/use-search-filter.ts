import { useMemo, useState } from "react";
import type { DGNode } from "../types";

export function useSearchFilter(dgNodes: DGNode[]) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");

  const matchingNodeIds = useMemo(() => {
    if (!searchTerm.trim() && selectedType === "all") {
      return new Set<string>();
    }

    const term = searchTerm.toLowerCase().trim();
    const matches = new Set<string>();

    for (const node of dgNodes) {
      const nameMatch = !term || node.name.toLowerCase().includes(term);
      const imageMatch =
        !term || (node.image ?? "").toLowerCase().includes(term);
      const typeMatch = selectedType === "all" || node.type === selectedType;

      if ((nameMatch || imageMatch) && typeMatch) {
        matches.add(node.id);
      }
    }

    return matches;
  }, [dgNodes, searchTerm, selectedType]);

  return {
    searchTerm,
    setSearchTerm,
    selectedType,
    setSelectedType,
    matchingNodeIds,
    hasFilter: Boolean(searchTerm.trim() || selectedType !== "all"),
    clearAll: () => {
      setSearchTerm("");
      setSelectedType("all");
    },
  };
}
