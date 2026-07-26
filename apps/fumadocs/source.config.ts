import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import type { Node, Parent } from "unist";
import { visit } from "unist-util-visit";

type CodeNode = Node & {
  type: "code";
  lang?: string | null;
  value: string;
};
type RootNode = Parent & { type: "root" };
type MdxAttributeNode = Node & {
  name: string;
  value: string;
};
type MdxFlowNode = Node & {
  name: string;
  attributes: MdxAttributeNode[];
  children: Node[];
};

function isCodeNode(node: Node): node is CodeNode {
  return (
    node.type === "code" && "value" in node && typeof node.value === "string"
  );
}

function remarkMermaid(): (tree: RootNode) => void {
  return (tree: RootNode): void => {
    visit(
      tree,
      "code",
      (node: Node, index: number | undefined, parent: Parent | undefined) => {
        if (
          !isCodeNode(node) ||
          node.lang !== "mermaid" ||
          !parent ||
          typeof index !== "number"
        ) {
          return;
        }
        const replacement: MdxFlowNode = {
          type: "mdxJsxFlowElement",
          name: "Mermaid",
          attributes: [
            {
              type: "mdxJsxAttribute",
              name: "chart",
              value: node.value,
            },
          ],
          children: [],
        };
        parent.children[index] = replacement;
      },
    );
  };
}

// You can customize Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMermaid],
  },
});
