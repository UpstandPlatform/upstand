"use client";

import { Menu01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@upstand/ui/components/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@upstand/ui/components/navigation-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@upstand/ui/components/sheet";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDocsUrl } from "@/lib/server-url";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./auth/user/user-avatar";
import { ModeToggle } from "./mode-toggle";

const NAV_LINKS = [
  { href: "/", label: "Home", external: false },
  { href: "/dashboard", label: "Dashboard", external: false },
  { href: "/docs", label: "Docs", external: true },
] as const;

export default function Header() {
  const pathname = usePathname();
  const docsUrl = getDocsUrl();

  return (
    <header className="sticky top-0 z-50 w-full border-border/40 border-b bg-background/70 backdrop-blur-md supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            aria-label="Upstand home"
            className="flex items-center gap-2 font-bold text-lg tracking-tight transition-opacity hover:opacity-80"
          >
            <Image
              src="/brand/logo.svg"
              alt=""
              width={32}
              height={32}
              priority
            />
            Upstand
          </Link>

          {/* Desktop nav */}
          <NavigationMenu className="hidden sm:flex">
            <NavigationMenuList>
              {NAV_LINKS.map(({ href, label, external }) => {
                const isActive = pathname === href;
                const href_ = external && href === "/docs" ? docsUrl : href;

                return (
                  <NavigationMenuItem key={href}>
                    <NavigationMenuLink
                      render={
                        external ? (
                          <a href={href_} suppressHydrationWarning>
                            {label}
                          </a>
                        ) : (
                          <Link href={href}>{label}</Link>
                        )
                      }
                      active={isActive}
                      className={navigationMenuTriggerStyle()}
                    />
                  </NavigationMenuItem>
                );
              })}
            </NavigationMenuList>
          </NavigationMenu>
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-2">
          <ModeToggle />

          <UserAvatar
            fallback={
              <Button
                variant="ghost"
                size="icon"
                render={
                  <Link href="/login" aria-label="Log in">
                    <HugeiconsIcon size={16} icon={UserIcon} />
                  </Link>
                }
                nativeButton={false}
              />
            }
          />

          {/* Mobile nav */}
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:hidden"
                  aria-label="Open navigation menu"
                >
                  <HugeiconsIcon
                    aria-hidden="true"
                    className="size-5"
                    icon={Menu01Icon}
                  />
                </Button>
              }
            />
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <nav
                aria-label="Mobile main navigation"
                className="flex flex-col gap-1 px-4"
              >
                {NAV_LINKS.map(({ href, label, external }) => {
                  const isActive = pathname === href;
                  const href_ = external && href === "/docs" ? docsUrl : href;
                  const className = cn(
                    "rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    isActive
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  );

                  return (
                    <SheetClose
                      key={href}
                      render={
                        external ? (
                          <a
                            href={href_}
                            className={className}
                            aria-current={isActive ? "page" : undefined}
                            suppressHydrationWarning
                          >
                            {label}
                          </a>
                        ) : (
                          <Link
                            href={href}
                            className={className}
                            aria-current={isActive ? "page" : undefined}
                          >
                            {label}
                          </Link>
                        )
                      }
                      nativeButton={false}
                    />
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
