import Link from 'next/link';
import {
  Zap,
  Users,
  GitBranch,
  Radio,
  Workflow,
  ArrowRight,
  CheckCircle2,
  XCircle,
  ShoppingBag,
  Home,
  Stethoscope,
  Car,
  Briefcase,
  Sparkles,
  CreditCard,
  Send,
  CheckCheck,
  Sparkle,
  Flame,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MarketingNavbar } from '@/components/marketing/navbar';
import { MarketingFooter } from '@/components/marketing/footer';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'WACRM — Enterprise WhatsApp CRM, AI Chatbots & Revenue Engine',
  description:
    'Turn WhatsApp into your #1 revenue channel. Official Meta Cloud API partner platform with multi-agent shared inbox, drag-and-drop conversational bot builder, live sales pipelines, catalog payments, and ERP sync.',
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      <MarketingNavbar />

      {/* 1. HERO SECTION WITH PRODUCT MOCKUP */}
      <section className="relative overflow-hidden border-b border-border/40 bg-gradient-to-b from-primary/10 via-background to-background pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:28px_28px]" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary mb-6 shadow-sm backdrop-blur-sm">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <Sparkles className="h-3.5 w-3.5" />
            <span>Official Meta Cloud API • Enterprise WhatsApp Marketing & CRM</span>
          </div>

          <h1 className="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-foreground leading-[1.15]">
            Supercharge Your WhatsApp into a{' '}
            <span className="bg-gradient-to-r from-emerald-500 via-teal-500 to-primary bg-clip-text text-transparent">
              High-Converting Sales Machine
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Empower your sales and support teams with a unified multi-agent shared inbox, drag-and-drop visual bot builder,
            instant WhatsApp payments, deal pipelines, and 98% open-rate broadcasts. Zero per-seat markup fees.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: 'lg' }), 'h-12 px-8 text-base shadow-lg shadow-primary/20 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold')}
            >
              Start 14-Day Free Trial <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-12 px-8 text-base border-border hover:bg-muted font-medium')}
            >
              Explore Live Dashboard
            </Link>
          </div>

          {/* Real ROI Metrics Bar */}
          <div className="mt-12 grid grid-cols-2 gap-4 border-t border-border/60 pt-8 sm:grid-cols-4 max-w-4xl mx-auto">
            <div className="p-2">
              <div className="text-3xl font-extrabold text-foreground">98%</div>
              <div className="text-xs text-muted-foreground mt-0.5">Average Message Open Rate</div>
            </div>
            <div className="p-2">
              <div className="text-3xl font-extrabold text-emerald-500">&lt; 3s</div>
              <div className="text-xs text-muted-foreground mt-0.5">AI & Automated Bot Reply Speed</div>
            </div>
            <div className="p-2">
              <div className="text-3xl font-extrabold text-foreground">3.8x</div>
              <div className="text-xs text-muted-foreground mt-0.5">Higher Sales Conversion vs Email</div>
            </div>
            <div className="p-2">
              <div className="text-3xl font-extrabold text-primary">0%</div>
              <div className="text-xs text-muted-foreground mt-0.5">Per-Agent Seat Penalties</div>
            </div>
          </div>

          {/* Interactive UI Preview Showcase Mockup */}
          <div className="mt-14 mx-auto max-w-5xl rounded-2xl border border-border/70 bg-card p-3 shadow-2xl shadow-primary/10 backdrop-blur-md">
            <div className="rounded-xl border border-border/60 bg-muted/30 p-2 sm:p-4">
              {/* Window Header */}
              <div className="flex items-center justify-between pb-3 border-b border-border/50 px-2">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500/80" />
                  <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                  <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                  <span className="ml-2 text-xs font-mono text-muted-foreground">wacrm-workspace • Official WhatsApp Business App</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                    Cloud API Connected
                  </span>
                </div>
              </div>

              {/* Mockup Body: 3-column app mockup */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mt-3 text-left">
                {/* Left Mini Sidebar / Chat List */}
                <div className="hidden md:block md:col-span-4 border border-border/50 rounded-lg bg-card/60 p-3 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-foreground px-1">
                    <span>Recent Chats (12 Online)</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-primary border-primary/30">Auto-Assigned</Badge>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="rounded-md bg-primary/15 border border-primary/30 p-2.5 space-y-1">
                      <div className="flex justify-between font-semibold text-foreground">
                        <span>Priya Sharma</span>
                        <span className="text-[10px] text-muted-foreground">Just now</span>
                      </div>
                      <p className="text-muted-foreground truncate">Interested in Diamond Solitaire Ring 18K</p>
                      <div className="flex gap-1 pt-1">
                        <span className="rounded bg-primary/20 text-primary px-1.5 py-0.2 text-[10px]">Hot Lead</span>
                        <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">Deal $2,400</span>
                      </div>
                    </div>

                    <div className="rounded-md hover:bg-muted/50 p-2.5 space-y-1 transition border border-transparent">
                      <div className="flex justify-between font-semibold text-foreground">
                        <span>Acme Corp Purchasing</span>
                        <span className="text-[10px] text-muted-foreground">4m ago</span>
                      </div>
                      <p className="text-muted-foreground truncate">Invoice #9021 confirmed via Razorpay</p>
                    </div>

                    <div className="rounded-md hover:bg-muted/50 p-2.5 space-y-1 transition border border-transparent">
                      <div className="flex justify-between font-semibold text-foreground">
                        <span>Rahul Verma</span>
                        <span className="text-[10px] text-muted-foreground">12m ago</span>
                      </div>
                      <p className="text-muted-foreground truncate">Scheduled showroom VIP consultation</p>
                    </div>
                  </div>
                </div>

                {/* Center Chat Transcript */}
                <div className="md:col-span-5 border border-border/50 rounded-lg bg-card/90 p-3 flex flex-col justify-between min-h-[290px]">
                  <div className="border-b border-border/40 pb-2 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <span>Priya Sharma</span>
                        <CheckCheck className="h-3.5 w-3.5 text-emerald-500" />
                      </div>
                      <span className="text-[10px] text-muted-foreground">+91 98201 02931 • WhatsApp Verified</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">Assigned: Sarah (Agent)</Badge>
                  </div>

                  {/* Bubble Stream */}
                  <div className="space-y-2 py-3 text-xs">
                    <div className="flex justify-start">
                      <div className="bg-muted text-foreground p-2.5 rounded-lg max-w-[85%] rounded-tl-none space-y-1">
                        <p>Hi! Can you share pricing and certification for the 1.5 Carat Solitaire ring?</p>
                        <span className="text-[9px] text-muted-foreground block text-right">10:42 AM</span>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <div className="bg-primary text-primary-foreground p-2.5 rounded-lg max-w-[85%] rounded-tr-none space-y-1.5">
                        <p>Hello Priya! Here is our IGI-certified collection with instant WhatsApp checkout link:</p>
                        <div className="rounded bg-black/20 p-2 text-[11px] border border-white/10 space-y-1">
                          <p className="font-semibold">💎 1.5 Ct Diamond Solitaire 18K Yellow Gold</p>
                          <p className="text-[10px] opacity-90">SKU: SOL-18K-15 • Price: $2,400</p>
                          <div className="mt-1 flex items-center justify-between bg-primary-foreground/20 rounded px-2 py-1 text-[10px] font-bold">
                            <span>1-Tap Razorpay / Stripe Link</span>
                            <span>🔒 Pay Now</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-1 text-[9px] opacity-80">
                          <span>10:42 AM</span>
                          <CheckCheck className="h-3 w-3 text-emerald-300" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Input row preview */}
                  <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="italic">Type a response, use @note or /canned-template...</span>
                    <Send className="h-3.5 w-3.5 text-primary" />
                  </div>
                </div>

                {/* Right Pipeline & Deal Info */}
                <div className="md:col-span-3 border border-border/50 rounded-lg bg-card/60 p-3 space-y-3">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <GitBranch className="h-3.5 w-3.5 text-primary" />
                    <span>Live Deal Stage</span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="p-2 rounded bg-muted/60 border border-border/40 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground">Pipeline Stage</span>
                      <p className="font-semibold text-foreground text-xs">Proposal Sent (75%)</p>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 w-[75%]" />
                      </div>
                    </div>

                    <div className="p-2 rounded bg-muted/60 border border-border/40 space-y-0.5">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground">Deal Value</span>
                      <p className="font-bold text-foreground text-sm">$2,400.00 USD</p>
                    </div>

                    <div className="p-2 rounded bg-muted/60 border border-border/40 space-y-0.5">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground">Assigned Rep</span>
                      <p className="text-xs text-foreground">Sarah Jenkins (Senior Sales)</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. THE REALITY: WHY BUSINESSES SWITCH FROM OLD PERSONAL WHATSAPP */}
      <section id="why" className="py-20 border-b border-border/40 bg-card/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">The Reality Check</h2>
            <h3 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Why Personal WhatsApp Numbers Are Leaking Your Revenue
            </h3>
            <p className="mt-4 text-muted-foreground">
              Running high-value sales conversations on individual sales reps&apos; personal devices creates massive data loss, zero transparency, and high customer churn.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {/* The Old Way */}
            <Card className="border-red-500/25 bg-red-500/5 shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-2 text-red-500 font-bold">
                  <XCircle className="h-5 w-5" />
                  <span>The Painful Old Way (Personal WhatsApp)</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="flex items-start gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                  <p><strong className="text-foreground">Severe Lead Theft & Data Loss:</strong> When sales reps resign, they walk away with your customer database and chat histories on their personal phones.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                  <p><strong className="text-foreground">Cold Leads & Delayed Responses:</strong> 3-hour lag times before someone responds to new ad inquiries, causing prospects to buy from faster rivals.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                  <p><strong className="text-foreground">Zero Management Visibility:</strong> Managers cannot audit conversations, check deal stages, or prevent unauthorized discounting.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                  <p><strong className="text-foreground">Permanent Ban Penalties:</strong> Unauthorized scraping tools and unofficial WA Web extensions lead to permanent Meta phone bans.</p>
                </div>
              </CardContent>
            </Card>

            {/* The WACRM Way */}
            <Card className="border-emerald-500/25 bg-emerald-500/5 shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-2 text-emerald-500 font-bold">
                  <CheckCircle2 className="h-5 w-5" />
                  <span>The WACRM Advantage (Enterprise Meta Cloud API)</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="flex items-start gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <p><strong className="text-foreground">100% Company-Owned Customer Data:</strong> One verified green-tick brand number. All chat records, contacts, and transactions remain safely inside your workspace.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <p><strong className="text-foreground">Instant &lt;3-Second Bot Qualification:</strong> 24/7 visual conversational flows capture intent, answer FAQs, and route VIP buyers immediately.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <p><strong className="text-foreground">Deal Stages with Real Dollar Values:</strong> Kanban sales boards allow managers to see pipeline velocity, deal values, and agent productivity in real time.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <p><strong className="text-foreground">Official Meta Approval & High Limits:</strong> 100% compliant with Meta Business APIs, safeguarding your phone number and delivering up to 100,000+ daily messages.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* 3. CORE COMPETITIVE ADVANTAGES (VS AISENSY, WATI, PICKY ASSIST) */}
      <section id="features" className="py-20 border-b border-border/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">Engineered to Win</h2>
            <h3 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Compare WACRM with Market Leaders
            </h3>
            <p className="mt-4 text-muted-foreground">
              Most platforms like Wati, AiSensy, and Respond charge hefty per-agent seat markups or hide CRM deal management. WACRM gives you the full enterprise stack.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-6 space-y-3.5 hover:border-primary/40 transition">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Users className="h-6 w-6" />
              </div>
              <h4 className="text-xl font-bold text-foreground">Multi-Agent Team Inbox</h4>
              <p className="text-sm text-muted-foreground">
                One number, unlimited agents. Assign conversations, collaborate with private internal team @notes, filter by tags, and send canned replies in 1 click.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 space-y-3.5 hover:border-primary/40 transition">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Workflow className="h-6 w-6" />
              </div>
              <h4 className="text-xl font-bold text-foreground">Visual Drag-and-Drop Flow Canvas</h4>
              <p className="text-sm text-muted-foreground">
                Visual mind-map node editor. Create branching question trees, interactive quick-reply buttons, order lookups, and human handoff routing effortlessly.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 space-y-3.5 hover:border-primary/40 transition">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <GitBranch className="h-6 w-6" />
              </div>
              <h4 className="text-xl font-bold text-foreground">Visual Kanban Sales Pipelines</h4>
              <p className="text-sm text-muted-foreground">
                Track prospects from initial inquiry to final payment. Drag and drop deal cards, assign monetary values, and calculate close rates by salesperson.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 space-y-3.5 hover:border-primary/40 transition">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CreditCard className="h-6 w-6" />
              </div>
              <h4 className="text-xl font-bold text-foreground">In-Chat Catalog & Payments</h4>
              <p className="text-sm text-muted-foreground">
                Send products with pictures, descriptions, and one-tap Razorpay & Stripe payment links directly inside the chat. Auto-reconcile invoices when paid.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 space-y-3.5 hover:border-primary/40 transition">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Radio className="h-6 w-6" />
              </div>
              <h4 className="text-xl font-bold text-foreground">Segmented Broadcast Campaigns</h4>
              <p className="text-sm text-muted-foreground">
                Send bulk broadcasts to thousands of filtered contacts or CSV lists with Meta-approved interactive templates, full delivery analytics, and read tracking.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 space-y-3.5 hover:border-primary/40 transition">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Zap className="h-6 w-6" />
              </div>
              <h4 className="text-xl font-bold text-foreground">Enterprise ERP & REST API</h4>
              <p className="text-sm text-muted-foreground">
                Developer API keys and webhooks. Integrate with Tally, Ever Gauzy, Marg ERP, SAP, Shopify, and Zapier to trigger automated invoices and order dispatches.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. TARGET VERTICALS */}
      <section id="verticals" className="py-20 border-b border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">Proven Across Industries</h2>
            <h3 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Built for High-Trust & High-Ticket Businesses
            </h3>
            <p className="mt-4 text-muted-foreground">
              From gold jewellery showrooms to luxury real estate developers and D2C brands, WACRM drives measurable revenue.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Jewellery */}
            <Card className="hover:border-primary/40 transition bg-card">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 mb-3">
                  <Sparkle className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Gold & Jewellery Retail</CardTitle>
                <CardDescription>Daily rates, savings schemes & custom orders</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• Automated 9:00 AM gold & silver rate broadcasts to VIP clients.</p>
                <p>• Monthly Dhanvarsha savings scheme payment reminder links.</p>
                <p>• Custom jewellery repair job-sheet tracking and advance collection.</p>
              </CardContent>
            </Card>

            {/* Real Estate */}
            <Card className="hover:border-primary/40 transition bg-card">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 mb-3">
                  <Home className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Real Estate & Developers</CardTitle>
                <CardDescription>Zero lead leakage & automated site visits</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• Instant floorplan and video brochure dispatch when ad leads submit forms.</p>
                <p>• Automated calendar booking for property walkthroughs and site tours.</p>
                <p>• Deal stage tracking from site visit scheduled to token advance.</p>
              </CardContent>
            </Card>

            {/* E-Commerce */}
            <Card className="hover:border-primary/40 transition bg-card">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 mb-3">
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">E-Commerce & D2C Brands</CardTitle>
                <CardDescription>Recover 30%+ abandoned checkouts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• Automated abandoned cart recovery sequences with instant checkout links.</p>
                <p>• Cash-on-Delivery (COD) 1-click verification buttons to cut RTO losses.</p>
                <p>• Post-purchase tracking updates and automated review collection.</p>
              </CardContent>
            </Card>

            {/* Healthcare */}
            <Card className="hover:border-primary/40 transition bg-card">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-500 mb-3">
                  <Stethoscope className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Clinics & Healthcare</CardTitle>
                <CardDescription>Cut appointment no-shows by 70%</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• 2-way interactive appointment confirmations and rescheduling.</p>
                <p>• Pre-appointment fasting and diagnostic preparation guidelines.</p>
                <p>• Automated digital prescription delivery directly on WhatsApp.</p>
              </CardContent>
            </Card>

            {/* Automobile */}
            <Card className="hover:border-primary/40 transition bg-card">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 mb-3">
                  <Car className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">Automobile Dealerships</CardTitle>
                <CardDescription>Test drives & periodic service booking</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• Test-drive booking and automated driver license collection.</p>
                <p>• Periodic vehicle service, insurance renewal, and PUC reminders.</p>
                <p>• Quotation PDF dispatch from dealership sales consultants.</p>
              </CardContent>
            </Card>

            {/* B2B Wholesale */}
            <Card className="hover:border-primary/40 transition bg-card">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3">
                  <Briefcase className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">B2B Wholesale & ERP</CardTitle>
                <CardDescription>Instant invoices & payment collection</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• Direct API dispatch from Tally, Marg ERP, and Ever Gauzy.</p>
                <p>• Automated overdue payment balance alerts with direct payment links.</p>
                <p>• Order confirmation and dispatch airway bill (AWB) alerts.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* 5. COMPETITOR COMPARISON TABLE */}
      <section id="comparison" className="py-20 border-b border-border/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">Clear Difference</h2>
            <h3 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              How WACRM Outperforms Legacy WhatsApp Tools
            </h3>
            <p className="mt-4 text-muted-foreground">
              See why forward-thinking companies are migrating from closed SaaS platforms like Wati and AiSensy to WACRM.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border border-border rounded-xl overflow-hidden">
              <thead className="bg-muted/60 border-b border-border text-xs uppercase font-semibold text-muted-foreground">
                <tr>
                  <th className="p-4">Key Capability</th>
                  <th className="p-4 text-primary font-bold text-sm bg-primary/5">WACRM Platform</th>
                  <th className="p-4">Wati</th>
                  <th className="p-4">AiSensy / Picky Assist</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="p-4 font-medium text-foreground">Per-Agent Seat Penalties</td>
                  <td className="p-4 text-emerald-500 font-bold bg-primary/5">$0 Unlimited Agent Support</td>
                  <td className="p-4 text-muted-foreground">$29+ per seat/month markup</td>
                  <td className="p-4 text-muted-foreground">Per-user surcharges</td>
                </tr>
                <tr>
                  <td className="p-4 font-medium text-foreground">Kanban Sales Pipeline & Deals</td>
                  <td className="p-4 text-emerald-500 font-bold bg-primary/5">Native with Real Dollar Values</td>
                  <td className="p-4 text-muted-foreground">Chat list only (No deals)</td>
                  <td className="p-4 text-muted-foreground">Requires external CRM sync</td>
                </tr>
                <tr>
                  <td className="p-4 font-medium text-foreground">In-Chat Product Catalog & Payments</td>
                  <td className="p-4 text-emerald-500 font-bold bg-primary/5">Razorpay & Stripe 1-Tap Links</td>
                  <td className="p-4 text-muted-foreground">Complex add-on</td>
                  <td className="p-4 text-muted-foreground">Third-party webhook only</td>
                </tr>
                <tr>
                  <td className="p-4 font-medium text-foreground">Multi-Tenant Agency Admin (/admin)</td>
                  <td className="p-4 text-emerald-500 font-bold bg-primary/5">Built-in (Manage Multiple Accounts)</td>
                  <td className="p-4 text-muted-foreground">Custom enterprise quote</td>
                  <td className="p-4 text-muted-foreground">Restricted to partner portal</td>
                </tr>
                <tr>
                  <td className="p-4 font-medium text-foreground">Data Ownership & Self-Host Options</td>
                  <td className="p-4 text-emerald-500 font-bold bg-primary/5">Full Database & API Access</td>
                  <td className="p-4 text-muted-foreground">Closed SaaS Cloud</td>
                  <td className="p-4 text-muted-foreground">Proprietary Closed System</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 6. TRANSPARENT PRICING */}
      <section id="pricing" className="py-20 border-b border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">Fair & Transparent</h2>
            <h3 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Simple, Predictable Plans for Every Stage
            </h3>
            <p className="mt-4 text-muted-foreground">
              Every plan includes official Meta Cloud API connectivity, shared inbox, and zero hidden agent seat penalties.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
            {/* Starter */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-xl font-bold">Starter</CardTitle>
                <CardDescription>For boutique teams and early startups</CardDescription>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-4xl font-extrabold text-foreground">₹1,499</span>
                  <span className="text-muted-foreground text-sm">($29) / month</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> 2 Team Agent Seats</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> Shared Multi-Agent Inbox</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> Visual Kanban Sales Pipeline</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> 1,000 Broadcasts / month</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> 1 Verified WhatsApp Number</li>
                </ul>
                <Link
                  href="/signup"
                  className={cn(buttonVariants({ variant: 'outline' }), 'w-full mt-6')}
                >
                  Get Started
                </Link>
              </CardContent>
            </Card>

            {/* Growth */}
            <div className="relative pt-3 lg:-mt-3">
              <Card className="border-2 border-primary shadow-xl overflow-visible bg-card relative">
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1 text-xs font-bold text-primary-foreground shadow-md ring-2 ring-background">
                    <Sparkles className="h-3.5 w-3.5" /> Most Popular
                  </span>
                </div>
                <CardHeader className="pt-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl font-bold">Growth</CardTitle>
                    <Badge variant="secondary" className="text-xs text-primary bg-primary/10">Recommended</Badge>
                  </div>
                  <CardDescription>For growing businesses and sales teams</CardDescription>
                  <div className="mt-4 flex items-baseline gap-1.5">
                    <span className="text-4xl font-extrabold text-foreground">₹3,499</span>
                    <span className="text-muted-foreground text-sm">($79) / month</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2.5 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> <span className="font-semibold text-foreground">5 Team Agent Seats</span></li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> Drag-and-Drop Flow Canvas</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> 10,000 Broadcasts / month</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> In-Chat Catalog & Payments</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> REST API & Webhooks (/api/v1)</li>
                  </ul>
                  <Link
                    href="/signup"
                    className={cn(buttonVariants({ size: 'lg' }), 'w-full mt-6 shadow-md bg-primary hover:bg-primary/90 text-primary-foreground')}
                  >
                    Start 14-Day Free Trial
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Scale */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-xl font-bold">Scale</CardTitle>
                <CardDescription>For high-volume operations & enterprises</CardDescription>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-4xl font-extrabold text-foreground">₹7,999</span>
                  <span className="text-muted-foreground text-sm">($179) / month</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> 15 Team Agent Seats</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> Up to 3 Phone Numbers</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> 50,000 Broadcasts / month</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> Custom ERP & Webhook Ingestion</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> Priority WhatsApp Delivery</li>
                </ul>
                <Link
                  href="/signup"
                  className={cn(buttonVariants({ variant: 'outline' }), 'w-full mt-6')}
                >
                  Contact Sales
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* 7. HIGH CONVERTING BOTTOM CTA */}
      <section className="py-20 bg-gradient-to-t from-primary/10 via-background to-background text-center">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
            <Flame className="h-3.5 w-3.5" />
            <span>Launch In 15 Minutes • Zero Technical Debt</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Ready to Triple Your WhatsApp Conversions?
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Connect your official WhatsApp number via Meta Embedded Signup in 2 clicks. No credit card required.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: 'lg' }), 'h-12 px-8 text-base gap-2 shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold')}
            >
              Claim 14-Day Free Trial <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-12 px-8 text-base')}
            >
              Sign In to Existing Account
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
