import { Badge } from "@upstand/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import type { DGNode } from "../types";
import { getStatusColor } from "../utils/colors";

export interface TableViewProps {
  nodes: DGNode[];
  onSelectNode: (id: string) => void;
}

export function TableView({ nodes, onSelectNode }: TableViewProps) {
  return (
    <div
      style={{ width: "100%", height: "100%", overflowY: "auto", padding: 16 }}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Resource Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Image / Driver</TableHead>
            <TableHead>Server / Host</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-8 text-center text-muted-foreground"
              >
                No topology resources detected.
              </TableCell>
            </TableRow>
          ) : (
            nodes.map((node) => {
              const statusInfo = getStatusColor(node.status);
              return (
                <TableRow
                  key={node.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onSelectNode(node.id)}
                >
                  <TableCell className="font-semibold">{node.name}</TableCell>
                  <TableCell className="capitalize">
                    <Badge variant="outline">{node.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 12,
                        background: statusInfo.bg,
                        color: statusInfo.text,
                      }}
                    >
                      {node.status ?? "healthy"}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    {node.image ?? node.driver ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    {node.serverName ?? node.ipAddress ?? "Local"}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
