
import { cn } from "@/lib/utils"

function Skeleton({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
              "rounded-md bg-gradient-to-r from-muted via-muted/40 to-muted bg-[length:200%_100%] [animation:shimmer_1.6s_ease-in-out_infinite]",
              className
            )}
            {...props}
        />
    )
}

export { Skeleton }
