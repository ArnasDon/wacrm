'use client';

import Link from 'next/link';
import {
  BookOpen,
  Rocket,
  ShieldAlert,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  MessageSquare,
  GitBranch,
  Radio,
  Workflow,
  Zap,
  Building2,
  ShieldCheck,
  Clock,
  ShoppingBag,
  Home,
  Stethoscope,
  Car,
  Briefcase,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function HelpCenterPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Client Onboarding & Help Center
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete operational manuals, feature guides, Meta WhatsApp compliance policies, and industry playbooks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/settings?tab=whatsapp"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
          >
            <span>WhatsApp Settings</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ size: 'sm' }))}
          >
            Return to Dashboard
          </Link>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="onboarding" className="w-full space-y-6">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto p-1 bg-muted/60">
          <TabsTrigger value="onboarding" className="flex items-center gap-2 py-2.5">
            <Rocket className="h-4 w-4" />
            <span>0-to-Live Onboarding</span>
          </TabsTrigger>
          <TabsTrigger value="features" className="flex items-center gap-2 py-2.5">
            <Layers className="h-4 w-4" />
            <span>Feature Manuals</span>
          </TabsTrigger>
          <TabsTrigger value="meta" className="flex items-center gap-2 py-2.5">
            <ShieldCheck className="h-4 w-4" />
            <span>Meta Guidelines & Anti-Ban</span>
          </TabsTrigger>
          <TabsTrigger value="industries" className="flex items-center gap-2 py-2.5">
            <Sparkles className="h-4 w-4" />
            <span>Industry Playbooks</span>
          </TabsTrigger>
        </TabsList>

        {/* ========================================================= */}
        {/* TAB 1: 0-TO-LIVE ONBOARDING GUIDE                         */}
        {/* ========================================================= */}
        <TabsContent value="onboarding" className="space-y-6">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-2">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              15-Minute Client Workspace Onboarding Checklist
            </h2>
            <p className="text-sm text-muted-foreground">
              Follow these sequential steps to onboard any client business from zero to live incoming and outgoing WhatsApp messages.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Step 1 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-primary border-primary/30">Step 1</Badge>
                  <span className="text-xs text-muted-foreground">Est. 2 mins</span>
                </div>
                <CardTitle className="text-base mt-2">Create Client Account & Organization</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>1. Have the business owner register at <code className="bg-muted px-1.5 py-0.5 rounded text-xs text-foreground">/signup</code> with their company email.</p>
                <p>2. Enter their Company / Business name (e.g. &quot;Apex Retailers Ltd&quot;). This creates a fresh, isolated multi-tenant organization.</p>
                <p>3. The creator is designated as the Workspace <strong>Owner</strong>.</p>
              </CardContent>
            </Card>

            {/* Step 2 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-primary border-primary/30">Step 2</Badge>
                  <span className="text-xs text-muted-foreground">Est. 3 mins</span>
                </div>
                <CardTitle className="text-base mt-2">Link WhatsApp Number (Meta Cloud API)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>1. Go to <strong>Settings → WhatsApp</strong> (<code className="bg-muted px-1.5 py-0.5 rounded text-xs text-foreground">/settings?tab=whatsapp</code>).</p>
                <p>2. Click <strong>&quot;Connect with Facebook / WhatsApp&quot;</strong> for instant 1-click Embedded Signup.</p>
                <p>3. Alternatively, enter manual credentials: <em>Phone Number ID</em>, <em>WABA ID</em>, and <em>Permanent System User Token</em> generated in Meta Developers.</p>
                <p>4. The status badge will switch to <span className="text-emerald-500 font-semibold">Connected</span> with green indicator.</p>
              </CardContent>
            </Card>

            {/* Step 3 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-primary border-primary/30">Step 3</Badge>
                  <span className="text-xs text-muted-foreground">Est. 3 mins</span>
                </div>
                <CardTitle className="text-base mt-2">Invite Staff & Configure Permissions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>1. Navigate to <strong>Settings → Members</strong> (<code className="bg-muted px-1.5 py-0.5 rounded text-xs text-foreground">/settings?tab=members</code>).</p>
                <p>2. Send invitations with specific roles:</p>
                <ul className="list-disc pl-5 space-y-1 text-xs">
                  <li><strong>Owner / Admin:</strong> Workspace config, billing, and WhatsApp credentials.</li>
                  <li><strong>Manager:</strong> Broadcast campaigns, visual flows, and performance reports.</li>
                  <li><strong>Agent:</strong> Answering chats in Shared Inbox, moving deals on Kanban pipelines.</li>
                </ul>
              </CardContent>
            </Card>

            {/* Step 4 */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-primary border-primary/30">Step 4</Badge>
                  <span className="text-xs text-muted-foreground">Est. 4 mins</span>
                </div>
                <CardTitle className="text-base mt-2">Import Audience & Setup Pipelines</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>1. Go to <strong>Contacts</strong> (<code className="bg-muted px-1.5 py-0.5 rounded text-xs text-foreground">/contacts</code>) and upload their existing customer CSV file.</p>
                <p>2. Ensure phone numbers include country code (e.g. +1, +91, +44).</p>
                <p>3. Go to <strong>Pipelines</strong> (<code className="bg-muted px-1.5 py-0.5 rounded text-xs text-foreground">/pipelines</code>) and customize deal stages (e.g. <em>New Lead → Qualified → Quote Sent → Closed Won</em>).</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ========================================================= */}
        {/* TAB 2: FEATURE MANUALS                                    */}
        {/* ========================================================= */}
        <TabsContent value="features" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Inbox */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">1. Shared Team Inbox (/inbox)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• <strong>Agent Assignment:</strong> Route conversations to specific team members to avoid double-replies.</p>
                <p>• <strong>Internal Private Notes:</strong> Type <code className="bg-muted px-1 text-foreground">@agent_name</code> to leave internal notes visible only to staff.</p>
                <p>• <strong>Canned Quick Replies:</strong> Insert pre-saved responses for pricing, address, bank info, or FAQs.</p>
                <p>• <strong>Contact Tags:</strong> Label chats with tags like <code className="bg-muted px-1 text-foreground">VIP</code>, <code className="bg-muted px-1 text-foreground">Urgent</code>, or <code className="bg-muted px-1 text-foreground">Hot Lead</code>.</p>
              </CardContent>
            </Card>

            {/* Flows */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <Workflow className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">2. Visual Flow Builder (/flows)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• <strong>Canvas Mind-Map:</strong> Drag-and-drop nodes to create decision trees with buttons and list menus.</p>
                <p>• <strong>Triggers:</strong> Fire on incoming keywords (e.g. &quot;Menu&quot;, &quot;Price&quot;) or on first-time messages.</p>
                <p>• <strong>Input Collection:</strong> Ask for email or city and automatically store them in custom contact fields.</p>
                <p>• <strong>Human Handoff:</strong> Seamlessly route the conversation to an agent in the Shared Inbox.</p>
              </CardContent>
            </Card>

            {/* Pipelines */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <GitBranch className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">3. Kanban Deal Pipelines (/pipelines)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• <strong>Drag-and-Drop:</strong> Move deals across custom sales stages with live currency sums.</p>
                <p>• <strong>Deal Values:</strong> Attach forecasted monetary amounts to each prospect.</p>
                <p>• <strong>Direct Chat Access:</strong> Click any deal card to jump directly into their WhatsApp conversation.</p>
              </CardContent>
            </Card>

            {/* Broadcasts */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <Radio className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">4. Broadcast Campaigns (/broadcasts)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• <strong>Segmented Sending:</strong> Target contacts filtered by tag or custom fields.</p>
                <p>• <strong>Meta Templates:</strong> Send approved templates with dynamic variables (<code className="bg-muted px-1 text-foreground">&#123;&#123;1&#125;&#125;</code> for name).</p>
                <p>• <strong>Delivery Analytics:</strong> Live metrics on sent, delivered, read, and replied counts.</p>
              </CardContent>
            </Card>

            {/* Admin Panel */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <Building2 className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">5. Multi-Tenant Admin (/admin)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• <strong>Supervise All Workspaces:</strong> Single dashboard viewing every client company on the CRM.</p>
                <p>• <strong>Connectivity Monitoring:</strong> Check active WhatsApp numbers and phone IDs in real time.</p>
                <p>• <strong>Subscription Management:</strong> Track Stripe plan tiers (Starter, Growth, Scale) and trial status.</p>
              </CardContent>
            </Card>

            {/* API & ERP */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <Zap className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">6. REST API & Webhooks (/api/v1)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• <strong>Outbound REST API:</strong> Send messages or sync contacts from SAP, Tally, Zoho, or your website.</p>
                <p>• <strong>Inbound Webhooks:</strong> Receive real-time JSON payloads when a customer messages or clicks a button.</p>
                <p>• <strong>Zapier / Make / n8n:</strong> Connect without code to Google Sheets, CRM, or accounting software.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ========================================================= */}
        {/* TAB 3: META GUIDELINES & ANTI-BAN POLICIES                */}
        {/* ========================================================= */}
        <TabsContent value="meta" className="space-y-6">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-2">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              Meta WhatsApp Cloud API Compliance & Anti-Ban Rules
            </h2>
            <p className="text-sm text-muted-foreground">
              Essential rules mandated by Meta. Following these guarantees high phone number quality ratings and prevents account restrictions.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* 24 Hour Window */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  1. The 24-Hour Customer Care Window
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>• When a customer sends you a message, a <strong>24-hour customer service window</strong> opens.</p>
                <p>• During this window, you can send <em>free-form text, images, voice notes, and files</em> with zero template restrictions.</p>
                <p>• Once 24 hours elapse since the customer&apos;s last message, you <strong>MUST</strong> use an approved Meta Message Template to re-open the conversation.</p>
              </CardContent>
            </Card>

            {/* Template Categories */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  2. Meta Template Categories
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>• <strong>Marketing:</strong> Promotional offers, product launches, newsletters, cart recovery.</p>
                <p>• <strong>Utility:</strong> Order confirmations, shipment tracking, account alerts, receipts.</p>
                <p>• <strong>Authentication:</strong> One-time password (OTP) verification codes.</p>
                <p className="text-xs text-amber-400 font-medium">⚠️ Never disguise marketing messages as utility templates. Meta monitors template content and rejects misclassified submissions.</p>
              </CardContent>
            </Card>

            {/* Phone Quality & Limits */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  3. Quality Rating & Messaging Limits
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>• Meta rates your number: <span className="text-emerald-500 font-medium">Green (High)</span>, <span className="text-amber-500 font-medium">Yellow (Medium)</span>, or <span className="text-red-500 font-medium">Red (Low)</span>.</p>
                <p>• <strong>Messaging Tiers:</strong> Starting limit is 1,000 unique recipients / 24 hrs. As you send quality messages without spam reports, Meta automatically upgrades your limit to <strong>10,000 → 100,000 → Unlimited</strong>.</p>
              </CardContent>
            </Card>

            {/* Anti-Ban Rules */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  4. Top Reasons for Phone Number Bans
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 text-sm text-muted-foreground">
                <p>❌ <strong>Cold Spamming:</strong> Sending broadcasts to bought or scraped phone numbers without prior opt-in consent.</p>
                <p>❌ <strong>Missing Opt-Out Option:</strong> Not providing a quick-reply button like <code className="bg-muted px-1 text-foreground">&quot;STOP / Unsubscribe&quot;</code>.</p>
                <p>❌ <strong>High Block/Report Rates:</strong> If more than 1–2% of recipients tap &quot;Block or Report Spam&quot; on WhatsApp, Meta flags the number immediately.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ========================================================= */}
        {/* TAB 4: INDUSTRY BLUEPRINTS                                */}
        {/* ========================================================= */}
        <TabsContent value="industries" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* E-Commerce */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">E-Commerce & D2C Blueprint</CardTitle>
                <CardDescription>25–45% Cart Recovery</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs text-muted-foreground">
                <p><strong>Trigger:</strong> Webhook from Shopify/WooCommerce when checkout is abandoned for 30 minutes.</p>
                <p><strong>WhatsApp Flow:</strong> Sends picture of product with button: <em>[Complete Order (10% Off)]</em>.</p>
                <p><strong>COD Verification:</strong> Sends 2-button prompt: <em>[Confirm Order] [Cancel Order]</em> before shipping to prevent return losses.</p>
              </CardContent>
            </Card>

            {/* Real Estate */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <Home className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">Real Estate Blueprint</CardTitle>
                <CardDescription>Instant Ad Lead Qualification</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs text-muted-foreground">
                <p><strong>Trigger:</strong> Meta Lead Ad or website WhatsApp QR code inquiry.</p>
                <p><strong>WhatsApp Flow:</strong> Instant PDF brochure delivery in 5s with interactive buttons: <em>[Book Site Visit] [Price Sheet] [Call Agent]</em>.</p>
                <p><strong>Pipeline:</strong> Automatically moves lead to <em>Site Visit Booked</em> stage upon date selection.</p>
              </CardContent>
            </Card>

            {/* Healthcare */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <Stethoscope className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">Clinics & Healthcare Blueprint</CardTitle>
                <CardDescription>0% Patient No-Shows</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs text-muted-foreground">
                <p><strong>Trigger:</strong> 24 hours and 2 hours before scheduled doctor appointment.</p>
                <p><strong>WhatsApp Flow:</strong> Sends interactive confirmation: <em>[Confirm Visit] [Reschedule]</em>.</p>
                <p><strong>Post-Op Care:</strong> Automatic follow-up 24 hours post-consultation with medication checklist.</p>
              </CardContent>
            </Card>

            {/* Automobile */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <Car className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">Automobile Dealership Blueprint</CardTitle>
                <CardDescription>Test Drives & Service Reminders</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs text-muted-foreground">
                <p><strong>Trigger:</strong> Customer explores models on dealer website.</p>
                <p><strong>WhatsApp Flow:</strong> Interactive list picker menu selecting car variant + instant test drive slot selector.</p>
                <p><strong>Retention:</strong> Scheduled broadcast 6 months post-delivery for first vehicle service.</p>
              </CardContent>
            </Card>

            {/* B2B Wholesale */}
            <Card>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <Briefcase className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">B2B Wholesale & ERP Blueprint</CardTitle>
                <CardDescription>Fast Invoice Approvals</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs text-muted-foreground">
                <p><strong>Trigger:</strong> Accounting software generates invoice (Tally / SAP / Zoho).</p>
                <p><strong>WhatsApp Flow:</strong> Dispatches invoice PDF directly with instant UPI / Stripe payment link.</p>
                <p><strong>Follow-Up:</strong> Automated reminder 48 hours before payment due date.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
