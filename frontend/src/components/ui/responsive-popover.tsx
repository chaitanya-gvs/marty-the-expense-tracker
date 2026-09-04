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
 * Gates rendering on client mount before consulting `isMobile`. This does NOT
 * currently prevent a Popover→Dialog remount on first client paint: `useIsMobile`
 * is itself false-first (matching desktop) until its own effect runs, and both
 * effects batch into the same re-render, so `mounted && isMobile` behaves
 * identically to `isMobile` alone. The gate is kept anyway because it's
 * harmless and guarantees SSR/desktop parity if `useIsMobile`'s initial-value
 * behavior ever changes.
 */
function useMounted() {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    setMounted(true)
  }, [])
  return mounted
}

/**
 * The Root decides the mode and publishes it via context. Trigger/Content MUST
 * read this context instead of calling useIsMobile/useMounted themselves: when
 * the Root switches from <Popover> to <Dialog> its children are remounted, which
 * resets any hook state they own to the false-first initial value, so a child
 * would render <PopoverTrigger> inside a <Dialog> and crash
 * ("PopoverTrigger must be used within Popover").
 */
const MobileModeContext = React.createContext(false)

type RootProps = React.ComponentProps<typeof PopoverPrimitive.Root>

function ResponsivePopover({ modal, ...props }: RootProps) {
  const isMobile = useIsMobile()
  const mounted = useMounted()
  const mobile = mounted && isMobile
  return (
    <MobileModeContext.Provider value={mobile}>
      {mobile ? (
        // Always modal on mobile: the sheet needs its scrim and focus trap.
        <Dialog {...props} />
      ) : (
        <Popover modal={modal} {...props} />
      )}
    </MobileModeContext.Provider>
  )
}

type TriggerProps = React.ComponentProps<typeof PopoverPrimitive.Trigger>

function ResponsivePopoverTrigger(props: TriggerProps) {
  const mobile = React.useContext(MobileModeContext)
  if (mobile) {
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
  const mobile = React.useContext(MobileModeContext)
  if (mobile) {
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
