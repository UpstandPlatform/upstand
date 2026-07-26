import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@upstand/ui/components/card";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";

export function PageSkeleton({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
      <Spinner className="size-8" />
      <span>{message}</span>
    </div>
  );
}

export function TableSkeleton({
  columns = 5,
  rows = 5,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: columns }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-20" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow key={rowIndex}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <TableCell key={colIndex}>
                  <Skeleton className="h-4 w-full max-w-[120px]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function CardGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className || "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="flex h-[180px] flex-col justify-between">
          <CardHeader className="flex flex-row items-start justify-between gap-4 p-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          </CardHeader>
          <CardContent className="flex-1 p-4 pt-0">
            <Skeleton className="mb-2 h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </CardContent>
          <CardFooter className="flex items-center justify-end gap-2 p-4 pt-0">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
