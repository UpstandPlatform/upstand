"use client";

import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@upstand/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import { cn } from "@upstand/ui/lib/utils";
import type { ReactNode } from "react";

export interface PageToolbarProps {
  children?: ReactNode;
  className?: string;
  /** Current search value. Toolbar renders the search field only when this is defined. */
  search?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  onClearSearch?: () => void;
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
}

export function PageToolbar({
  children,
  className,
  search,
  searchLabel = "Search",
  searchPlaceholder = "Search…",
  onSearchChange,
  onClearSearch,
  onClearFilters,
  hasActiveFilters = false,
}: PageToolbarProps) {
  const hasSearch = typeof search === "string" && Boolean(onSearchChange);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {hasSearch ? (
        <InputGroup className="min-w-56 flex-1 sm:max-w-sm">
          <InputGroupInput
            type="search"
            value={search}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            className={cn(
              "[&::-webkit-search-cancel-button]:hidden",
              "[&::-webkit-search-decoration]:hidden",
              "[&::-ms-clear]:hidden [&::-ms-reveal]:hidden",
            )}
          />
          <InputGroupAddon align="inline-start">
            <HugeiconsIcon icon={Search01Icon} aria-hidden="true" />
          </InputGroupAddon>
          {search ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                aria-label={`Clear ${searchLabel.toLowerCase()}`}
                onClick={onClearSearch}
              >
                <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      ) : null}

      {children}

      {hasActiveFilters && onClearFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
