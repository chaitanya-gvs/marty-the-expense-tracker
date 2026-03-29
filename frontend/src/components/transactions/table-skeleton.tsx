
import { Skeleton } from "@/components/ui/skeleton"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

export function TableSkeleton() {
    return (
        <div className="rounded-md border border-border bg-card">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent border-border">
                        {/* Date ~120px */}
                        <TableHead className="w-[120px]"><Skeleton className="h-3 w-16 bg-muted/40" /></TableHead>
                        {/* Description ~420px */}
                        <TableHead className="w-[420px]"><Skeleton className="h-3 w-40 bg-muted/40" /></TableHead>
                        {/* Amount ~120px right-aligned */}
                        <TableHead className="w-[120px] text-right"><Skeleton className="h-3 w-20 bg-muted/40 ml-auto" /></TableHead>
                        {/* Account ~110px */}
                        <TableHead className="w-[110px]"><Skeleton className="h-3 w-24 bg-muted/40" /></TableHead>
                        {/* Category ~110px */}
                        <TableHead className="w-[110px]"><Skeleton className="h-3 w-28 bg-muted/40" /></TableHead>
                        {/* Tags ~120px */}
                        <TableHead className="w-[120px]"><Skeleton className="h-3 w-16 bg-muted/40" /></TableHead>
                        {/* Actions ~60px */}
                        <TableHead className="w-[60px] text-right"><Skeleton className="h-3 w-10 bg-muted/40 ml-auto" /></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {Array.from({ length: 15 }).map((_, i) => (
                        <TableRow key={i} className="border-border hover:bg-transparent">
                            {/* Date */}
                            <TableCell>
                                <div className="h-3 w-16 bg-muted/40 rounded animate-pulse" />
                            </TableCell>
                            {/* Description */}
                            <TableCell>
                                <div className="space-y-1.5">
                                    <div className="h-3 w-64 bg-muted/40 rounded animate-pulse" />
                                    <div className="h-2.5 w-40 bg-muted/30 rounded animate-pulse" />
                                </div>
                            </TableCell>
                            {/* Amount */}
                            <TableCell>
                                <div className="flex justify-end">
                                    <div className="h-6 w-20 bg-muted/40 rounded-md animate-pulse ml-auto" />
                                </div>
                            </TableCell>
                            {/* Account */}
                            <TableCell>
                                <div className="h-6 w-24 bg-muted/40 rounded-md animate-pulse" />
                            </TableCell>
                            {/* Category */}
                            <TableCell>
                                <div className="h-6 w-28 bg-muted/40 rounded-md animate-pulse" />
                            </TableCell>
                            {/* Tags — two pill shapes */}
                            <TableCell>
                                <div className="flex gap-1">
                                    <div className="h-4 w-14 bg-muted/40 rounded-full animate-pulse" />
                                    <div className="h-4 w-12 bg-muted/40 rounded-full animate-pulse" />
                                </div>
                            </TableCell>
                            {/* Actions */}
                            <TableCell>
                                <div className="h-4 w-10 bg-muted/40 rounded animate-pulse ml-auto" />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
