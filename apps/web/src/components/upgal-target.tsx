"use client";

import type {
  UpGalUiTargetAction,
  UpGalUiTargetDefinition,
  UpGalUiTargetKind,
} from "@upstand/api/ai/upgal-ui-targets";
import { cloneElement, type ReactElement } from "react";

export type UpGalTargetKind = UpGalUiTargetKind;
export type UpGalTargetAction = UpGalUiTargetAction;
export type UpGalTargetDefinition<Id extends string = string> =
  UpGalUiTargetDefinition<Id>;

type UpGalTargetAttributes = {
  "data-upgal-target": string;
  "data-upgal-label": string;
  "data-upgal-description"?: string;
  "data-upgal-kind": UpGalTargetKind;
  "data-upgal-action"?: UpGalTargetAction;
  "data-upgal-path"?: string;
};

export function defineUpGalTarget<const Id extends string>(
  definition: UpGalTargetDefinition<Id>,
): UpGalTargetDefinition<Id> {
  return definition;
}

export function UpGalTarget<const Id extends string>({
  definition,
  children,
}: {
  definition: UpGalTargetDefinition<Id>;
  children: ReactElement;
}) {
  const attributes: UpGalTargetAttributes = {
    "data-upgal-target": definition.id,
    "data-upgal-label": definition.label,
    ...(definition.description
      ? { "data-upgal-description": definition.description }
      : {}),
    "data-upgal-kind": definition.kind,
    ...(definition.action ? { "data-upgal-action": definition.action } : {}),
    ...(definition.path ? { "data-upgal-path": definition.path } : {}),
  };

  return cloneElement(children, attributes as never);
}
