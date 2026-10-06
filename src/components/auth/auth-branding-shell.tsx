"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Truck,
  MessageSquare,
  Bot,
  Radio,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export function AuthBrandingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-background grid grid-cols-1 lg:grid-cols-12 overflow-x-hidden">
      {/* ============================================================ */}
      {/* LEFT COLUMN: FlyOrder Brand Showcase (Desktop)               */}
      {/* ============================================================ */}
      <div className="hidden lg:flex lg:col-span-6 xl:col-span-7 relative flex-col justify-between p-8 xl:p-12 bg-slate-950 text-white overflow-hidden border-r border-slate-800/80">
        {/* Subtle Ambient Background Gradients */}
        <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="pointer-events-none absolute top-1/2 -right-32 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-96 w-96 rounded-full bg-sky-600/15 blur-3xl" />
        
        {/* Geometric Grid Pattern */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: "32px 32px",
          }}
        />

        {/* Top: Brand Header */}
        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" className="group flex items-center gap-3 transition-transform hover:scale-[1.02]">
            <div className="relative h-12 w-12 rounded-2xl bg-white p-1.5 shadow-xl shadow-cyan-500/20 ring-2 ring-cyan-500/40 transition-all group-hover:ring-cyan-400">
              <Image
                src="/flyorder-logo.png"
                alt="Fly Order Logo"
                width={48}
                height={48}
                priority
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight text-white">
                  Fly Order
                </span>
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  CRM v2.0
                </span>
              </div>
              <p className="text-[11px] font-medium tracking-wider text-cyan-400 uppercase">
                Logistics & Delivery
              </p>
            </div>
          </Link>
          <div className="hidden xl:flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-xs text-slate-300 backdrop-blur-md">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            Meta WhatsApp API Connected
          </div>
        </div>

        {/* Middle: Brand Pitch & Live Mockup */}
        <div className="relative z-10 my-auto py-8 space-y-8 max-w-xl">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
              <Sparkles className="size-3.5 text-cyan-400" />
              Next-Gen Delivery Operations
            </div>
            <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight text-white leading-tight">
              Smart WhatsApp CRM built for High-Performance Delivery.
            </h1>
            <p className="text-sm xl:text-base text-slate-400 leading-relaxed">
              Automate parcel tracking updates, empower team agents with collaborative inbox management, and leverage 24/7 AI-driven WhatsApp customer care.
            </p>
          </div>

          {/* Interactive Live WhatsApp Chat Preview Card */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-5 backdrop-blur-xl shadow-2xl relative overflow-hidden group transition-all hover:border-cyan-500/40">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs ring-1 ring-emerald-500/40">
                  WA
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-200">Fly Order Logistics Bot</span>
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                  </div>
                  <span className="text-[10px] text-slate-400">Automated Dispatch Assistant</span>
                </div>
              </div>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 border border-cyan-800/50 px-2 py-0.5 rounded-full">
                ⚡ 0.2s Response
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="self-end bg-slate-800/90 text-slate-200 rounded-xl rounded-tr-xs p-2.5 max-w-[85%] ml-auto">
                Where is my shipment #FO-8910?
              </div>
              <div className="bg-emerald-950/40 border border-emerald-800/30 text-emerald-200 rounded-xl rounded-tl-xs p-2.5 max-w-[90%]">
                <p className="font-medium text-emerald-300">📦 Package is Out for Delivery!</p>
                <p className="mt-1 text-slate-300 text-[11px]">Courier Karim is arriving today by 3:45 PM.</p>
                <div className="mt-2 pt-2 border-t border-emerald-800/30 flex items-center justify-between">
                  <span className="text-[10px] text-cyan-400 font-semibold underline">
                    📍 Live Tracking Link: flyorder.com/t/FO-8910
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 3 Core Highlights */}
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 space-y-1">
              <Truck className="size-4 text-cyan-400" />
              <div className="text-xs font-semibold text-slate-200">Live Tracking</div>
              <div className="text-[10px] text-slate-400">Direct WhatsApp status</div>
            </div>
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 space-y-1">
              <MessageSquare className="size-4 text-emerald-400" />
              <div className="text-xs font-semibold text-slate-200">Team Inbox</div>
              <div className="text-[10px] text-slate-400">Zero missed messages</div>
            </div>
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 space-y-1">
              <Bot className="size-4 text-sky-400" />
              <div className="text-xs font-semibold text-slate-200">AI Assistant</div>
              <div className="text-[10px] text-slate-400">24/7 intelligent triage</div>
            </div>
          </div>
        </div>

        {/* Bottom: Trust & Security */}
        <div className="relative z-10 flex items-center justify-between text-xs text-slate-500 pt-4 border-t border-slate-800/60">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-emerald-400" />
            <span>End-to-End Secure • Multi-Tenant Isolated</span>
          </div>
          <span>© 2026 Fly Order</span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* RIGHT COLUMN: Authentication Form                            */}
      {/* ============================================================ */}
      <div className="col-span-1 lg:col-span-6 xl:col-span-5 flex flex-col justify-between items-center p-4 sm:p-8 min-h-screen relative bg-background">
        {/* Subtle decorative radial glow for right side */}
        <div className="pointer-events-none absolute top-0 right-0 h-80 w-80 rounded-full bg-cyan-500/5 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl" />

        {/* Mobile Header (visible only on screens < lg) */}
        <div className="w-full flex flex-col items-center pt-4 pb-2 lg:hidden">
          <Link href="/" className="flex flex-col items-center gap-2 group">
            <div className="relative h-14 w-14 rounded-2xl bg-white p-1.5 shadow-lg shadow-cyan-500/10 ring-2 ring-cyan-500/30">
              <Image
                src="/flyorder-logo.png"
                alt="Fly Order Logo"
                width={56}
                height={56}
                priority
                className="h-full w-full object-contain"
              />
            </div>
            <div className="text-center">
              <span className="text-lg font-bold text-foreground">Fly Order</span>
              <p className="text-[10px] font-semibold tracking-wider text-cyan-600 dark:text-cyan-400 uppercase">
                Logistics & Delivery CRM
              </p>
            </div>
          </Link>
        </div>

        {/* Form Container */}
        <div className="w-full max-w-md my-auto py-6">
          {children}
        </div>

        {/* Footer info */}
        <div className="w-full text-center text-xs text-muted-foreground pt-4 pb-2">
          <span>Fly Order Logistics & Delivery • Official WhatsApp CRM</span>
        </div>
      </div>
    </div>
  );
}
