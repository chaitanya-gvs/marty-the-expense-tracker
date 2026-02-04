
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
        <div className="rounded-md border border-slate-800 bg-slate-900/50">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent border-slate-800">
                        <TableHead className="w-[40px]"><Skeleton className="h-4 w-4" /></TableHead>
                        <TableHead className="w-[100px]"><Skeleton className="h-4 w-20" /></TableHead>
                        <TableHead className="w-[350px]"><Skeleton className="h-4 w-40" /></TableHead>
                        <TableHead className="w-[120px] text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableHead>
                        <TableHead className="w-[150px]"><Skeleton className="h-4 w-24" /></TableHead>
                        <TableHead className="w-[150px]"><Skeleton className="h-4 w-20" /></TableHead>
                        <TableHead className="w-[200px]"><Skeleton className="h-4 w-32" /></TableHead>
                        <TableHead className="w-[100px] text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {Array.from({ length: 15 }).map((_, i) => (
                        <TableRow key={i} className="border-slate-800 hover:bg-transparent">
                            <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                            <TableCell>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-[250px]" />
                                    <Skeleton className="h-3 w-[200px]" />
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="flex flex-col items-end gap-1">
                                    <Skeleton className="h-6 w-20 rounded-full" />
                                    <Skeleton className="h-3 w-12" />
                                </div>
                            </TableCell>
                            <TableCell><Skeleton className="h-6 w-28 rounded-full" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                            <TableCell>
                                <div className="flex gap-1">
                                    <Skeleton className="h-5 w-16 rounded-full" />
                                    <Skeleton className="h-5 w-16 rounded-full" />
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="flex justify-end gap-2">
                                    <Skeleton className="h-8 w-8 rounded-md" />
                                    <Skeleton className="h-8 w-8 rounded-md" />
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}
