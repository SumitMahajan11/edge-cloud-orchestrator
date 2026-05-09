import * as React from "react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet"
import { cn } from "../../lib/utils"

interface DrawerPanelProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  width?: "sm" | "md" | "lg" | "xl" | "full"
}

const widthMap = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  full: "sm:max-w-full",
}

export function DrawerPanel({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
  width = "md",
}: DrawerPanelProps) {
  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent 
        className={cn("bg-card border-l border-border h-full flex flex-col p-0", widthMap[width], className)}
      >
        <SheetHeader className="p-6 border-b border-border">
          <SheetTitle className="text-xl font-bold text-foreground">{title}</SheetTitle>
          {description && (
            <SheetDescription className="text-sm text-muted-foreground">
              {description}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
