"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

/**
 * Drop-in replacement for Popover/PopoverTrigger/PopoverContent that renders a
 * bottom-anchored Dialog sheet on mobile (<768px) and the normal anchored
 * Popover on desktop. Only for tap-to-open pickers — never for typeahead
 * suggestions anchored to an input (a modal Dialog would steal focus from it).
 * See docs/superpowers/specs/2026-08-14-mobile-pickers-design.md.
 */

/**
 * Renders the desktop (Popover) variant until after hydration, matching what
 * the server emitted. Without it the first client paint on a phone swaps
 * Popover→Dialog, remounting the whole subtree (and losing any open state).
 */
function useMounted() {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    setMounted(true)
  }, [])
  return mounted
}

type RootProps = React.ComponentProps<typeof PopoverPrimitive.Root>

function ResponsivePopover({ modal, ...props }: RootProps) {
  const isMobile = useIsMobile()
  const mounted = useMounted()
  if (mounted && isMobile) {
    // Always modal on mobile: the sheet needs its scrim and focus trap.
    return <Dialog {...props} />
  }
  return <Popover modal={modal} {...props} />
}

type TriggerProps = React.ComponentProps<typeof PopoverPrimitive.Trigger>

function ResponsivePopoverTrigger(props: TriggerProps) {
  const isMobile = useIsMobile()
  const mounted = useMounted()
  if (mounted && isMobile) {
    return <DialogTrigger {...(props as React.ComponentProps<typeof DialogPrimitive.Trigger>)} />
  }
  return <PopoverTrigger {...props} />
}

type ContentProps = React.ComponentProps<typeof PopoverContent> & {
  /** Accessible name for the mobile sheet (rendered sr-only). */
  title?: string
}

function ResponsivePopoverContent({
  title = "Options",
  className,
  children,
  // popover-only positioning props — stripped on mobile
  align,
  alignOffset,
  side,
  sideOffset,
  avoidCollisions,
  collisionPadding,
  collisionBoundary,
  sticky,
  hideWhenDetached,
  arrowPadding,
  updatePositionStrategy,
  container,
  ...rest
}: ContentProps) {
  const isMobile = useIsMobile()
  const mounted = useMounted()

  if (mounted && isMobile) {
    const {
      onOpenAutoFocus,
      onCloseAutoFocus,
      onEscapeKeyDown,
      onPointerDownOutside,
      onInteractOutside,
      onMouseLeave,
      style,
    } = rest
    return (
      <DialogContent
        showCloseButton={false}
        container={container}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={onEscapeKeyDown}
        onPointerDownOutside={onPointerDownOutside}
        onInteractOutside={onInteractOutside}
        onMouseLeave={onMouseLeave}
        style={style}
        className={cn(
          "bg-popover text-popover-foreground p-2 max-h-[60dvh] overflow-y-auto",
          "[&_[role=option]]:min-h-11 [&_[cmdk-item]]:min-h-11 [&_[role=button]]:min-h-11",
          className
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {/*
          Consumers pass `p-0`, which tailwind-merge strips DialogContent's own
          `pb-[max(1.5rem,env(safe-area-inset-bottom))]` along with. Re-add the
          bottom inset here so the last row never sits under the home indicator.
        */}
        <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))]">{children}</div>
      </DialogContent>
    )
  }

  return (
    <PopoverContent
      className={className}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      avoidCollisions={avoidCollisions}
      collisionPadding={collisionPadding}
      collisionBoundary={collisionBoundary}
      sticky={sticky}
      hideWhenDetached={hideWhenDetached}
      arrowPadding={arrowPadding}
      updatePositionStrategy={updatePositionStrategy}
      container={container}
      {...rest}
    >
      {children}
    </PopoverContent>
  )
}

export { ResponsivePopover, ResponsivePopoverTrigger, ResponsivePopoverContent }
