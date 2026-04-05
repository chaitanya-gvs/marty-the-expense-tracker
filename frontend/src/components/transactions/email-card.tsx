"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmailMetadata, EmailDetails, EmailPayload } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  Link2,
  Unlink,
  Mail,
  Loader2,
  Car,
  UtensilsCrossed,
  Package,
  ShoppingBag,
} from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format-utils";

interface EmailCardProps {
  email: EmailMetadata;
  isLinked: boolean;
  onLink: (messageId: string) => Promise<void>;
  onUnlink: (messageId: string) => Promise<void>;
  onFetchDetails: (messageId: string) => Promise<EmailDetails>;
}

export function EmailCard({
  email,
  isLinked,
  onLink,
  onUnlink,
  onFetchDetails,
}: EmailCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [emailDetails, setEmailDetails] = useState<EmailDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  // ── Merchant detection ────────────────────────────────────────────
  const getMerchantBadge = () => {
    const subject = email.subject?.toLowerCase() || "";
    const sender = email.sender?.toLowerCase() || "";
    const combined = `${subject} ${sender}`;

    if (combined.includes("uber")) return { icon: Car, name: "Uber" };
    if (combined.includes("ola")) return { icon: Car, name: "Ola" };
    if (combined.includes("swiggy") || combined.includes("instamart")) return { icon: UtensilsCrossed, name: combined.includes("instamart") ? "Instamart" : "Swiggy" };
    if (combined.includes("zomato")) return { icon: UtensilsCrossed, name: "Zomato" };
    if (combined.includes("amazon")) return { icon: Package, name: "Amazon" };
    if (combined.includes("flipkart")) return { icon: ShoppingBag, name: "Flipkart" };
    if (combined.includes("myntra")) return { icon: ShoppingBag, name: "Myntra" };
    if (combined.includes("bigbasket")) return { icon: ShoppingBag, name: "BigBasket" };
    return null;
  };

  const merchantBadge = getMerchantBadge();

  const isUberEmail =
    email.subject?.toLowerCase().includes("uber") ||
    email.sender?.toLowerCase().includes("uber");
  const isSwiggyEmail =
    email.subject?.toLowerCase().includes("swiggy") ||
    email.sender?.toLowerCase().includes("swiggy") ||
    email.subject?.toLowerCase().includes("instamart") ||
    email.sender?.toLowerCase().includes("instamart");

  // Auto-fetch rich details for supported merchants
  useEffect(() => {
    if ((isUberEmail || isSwiggyEmail) && !emailDetails && !isLoadingDetails) {
      setIsLoadingDetails(true);
      onFetchDetails(email.id)
        .then(setEmailDetails)
        .catch(() => {})
        .finally(() => setIsLoadingDetails(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUberEmail, isSwiggyEmail, email.id]);

  const handleToggleExpand = async () => {
    if (!isExpanded && !emailDetails) {
      setIsLoadingDetails(true);
      try {
        const details = await onFetchDetails(email.id);
        setEmailDetails(details);
      } catch {
        // handled silently
      } finally {
        setIsLoadingDetails(false);
      }
    }
    setIsExpanded(!isExpanded);
  };

  const handleLinkToggle = async () => {
    setIsLinking(true);
    try {
      if (isLinked) await onUnlink(email.id);
      else await onLink(email.id);
    } catch {
      // handled by parent
    } finally {
      setIsLinking(false);
    }
  };

  const formatEmailDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "MMM dd, yyyy HH:mm");
    } catch {
      return dateString;
    }
  };

  const extractSenderName = (sender: string) => {
    const match = sender.match(/^([^<]+)</);
    if (match) return match[1].trim();
    return sender.split("@")[0];
  };

  const senderName = extractSenderName(email.sender);
  const dateStr = formatEmailDate(email.date);

  // Deduplicate sender if it matches merchant badge
  const showSender =
    !merchantBadge ||
    !senderName.toLowerCase().includes(merchantBadge.name.toLowerCase());

  const hasRichPreview =
    (isUberEmail || isSwiggyEmail) &&
    (emailDetails?.uber_trip_info || emailDetails?.swiggy_order_info);

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-200 overflow-hidden",
        isLinked
          ? "border-violet-400/40 bg-violet-400/[0.04]"
          : "border-border bg-card"
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Subject */}
          <Mail className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
          <p className="text-sm font-medium truncate flex-1 min-w-0">
            {email.subject || "(No Subject)"}
          </p>

          {/* Merchant badge */}
          {merchantBadge && (
            <Badge
              variant="outline"
              className="text-xs px-1.5 py-0 bg-muted/40 border-border/60 text-muted-foreground gap-1 flex-shrink-0"
            >
              <merchantBadge.icon className="h-3 w-3" />
              {merchantBadge.name}
            </Badge>
          )}

          {/* Unlink / Link */}
          {isLinked ? (
            <button
              type="button"
              onClick={handleLinkToggle}
              disabled={isLinking}
              aria-label="Unlink email"
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
            >
              {isLinking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unlink className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={handleLinkToggle}
              disabled={isLinking}
              className="h-6 text-xs px-2 flex-shrink-0"
            >
              {isLinking ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Link2 className="h-3 w-3 mr-1" />
                  Link
                </>
              )}
            </Button>
          )}

          {/* Expand */}
          <button
            type="button"
            onClick={handleToggleExpand}
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/60 transition-colors flex-shrink-0"
          >
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* ── Metadata line ─────────────────────────────────────────── */}
        <p className="text-xs text-muted-foreground/60 mt-1 ml-[22px] truncate">
          {[showSender ? senderName : null, dateStr].filter(Boolean).join(" · ")}
        </p>

        {/* ── Rich preview (Uber / Swiggy) ─────────────────────────── */}
        {hasRichPreview && (
          <div className="ml-[22px] mt-2.5 pt-2.5 border-t border-border/40">
            {emailDetails?.uber_trip_info && (
              <UberPreview info={emailDetails.uber_trip_info} />
            )}
            {emailDetails?.swiggy_order_info && (
              <SwiggyPreview info={emailDetails.swiggy_order_info} />
            )}
          </div>
        )}

        {/* Loading indicator for merchant emails */}
        {(isUberEmail || isSwiggyEmail) && isLoadingDetails && !emailDetails && (
          <div className="ml-[22px] mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/50">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading details…
          </div>
        )}
      </div>

      {/* ── Expanded content ───────────────────────────────────────── */}
      {isExpanded && (
        <div className="border-t border-border/40 px-4 py-3 space-y-4">
          {isLoadingDetails ? (
            <div className="flex items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading email content…
            </div>
          ) : emailDetails ? (
            <>
              {/* Uber expanded */}
              {emailDetails.uber_trip_info && (
                <ExpandedSection
                  icon={<Car className="h-3.5 w-3.5 text-violet-400" />}
                  title="Trip Details"
                >
                  <DetailGrid
                    rows={[
                      emailDetails.uber_trip_info.amount && {
                        label: "Amount",
                        value: (
                          <span className="font-mono tabular-nums">
                            ₹{emailDetails.uber_trip_info.amount}
                          </span>
                        ),
                      },
                      emailDetails.uber_trip_info.vehicle_type && {
                        label: "Vehicle",
                        value: emailDetails.uber_trip_info.vehicle_type,
                      },
                      (emailDetails.uber_trip_info.start_time ||
                        emailDetails.uber_trip_info.end_time) && {
                        label: "Time",
                        value: [
                          emailDetails.uber_trip_info.start_time,
                          emailDetails.uber_trip_info.end_time,
                        ]
                          .filter(Boolean)
                          .join(" → "),
                      },
                      emailDetails.uber_trip_info.from_location && {
                        label: "From",
                        value: emailDetails.uber_trip_info.from_location,
                      },
                      emailDetails.uber_trip_info.to_location && {
                        label: "To",
                        value: emailDetails.uber_trip_info.to_location,
                      },
                      (emailDetails.uber_trip_info.distance ||
                        emailDetails.uber_trip_info.duration) && {
                        label: "Distance",
                        value: [
                          emailDetails.uber_trip_info.distance,
                          emailDetails.uber_trip_info.duration,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                      },
                    ]}
                  />
                </ExpandedSection>
              )}

              {/* Swiggy expanded */}
              {emailDetails.swiggy_order_info && (
                <ExpandedSection
                  icon={<UtensilsCrossed className="h-3.5 w-3.5 text-amber-400" />}
                  title="Order Details"
                >
                  <DetailGrid
                    rows={[
                      emailDetails.swiggy_order_info.restaurant_name && {
                        label: "Restaurant",
                        value: emailDetails.swiggy_order_info.restaurant_name,
                      },
                      emailDetails.swiggy_order_info.amount && {
                        label: "Amount",
                        value: (
                          <span className="flex items-center gap-2">
                            <span className="font-mono tabular-nums">
                              ₹{emailDetails.swiggy_order_info.amount}
                            </span>
                            {emailDetails.swiggy_order_info.savings && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 bg-emerald-400/10 border-emerald-400/30 text-emerald-400"
                              >
                                Saved ₹{emailDetails.swiggy_order_info.savings}
                              </Badge>
                            )}
                          </span>
                        ),
                      },
                      (emailDetails.swiggy_order_info.order_date ||
                        emailDetails.swiggy_order_info.order_time) && {
                        label: "Date / Time",
                        value: [
                          emailDetails.swiggy_order_info.order_date,
                          emailDetails.swiggy_order_info.order_time,
                        ]
                          .filter(Boolean)
                          .join(" "),
                      },
                      emailDetails.swiggy_order_info.order_type && {
                        label: "Type",
                        value: emailDetails.swiggy_order_info.order_type,
                      },
                      emailDetails.swiggy_order_info.num_diners && {
                        label: "Diners",
                        value: `${emailDetails.swiggy_order_info.num_diners} ${
                          emailDetails.swiggy_order_info.num_diners === 1
                            ? "person"
                            : "people"
                        }`,
                      },
                      emailDetails.swiggy_order_info.items?.length && {
                        label: "Items",
                        value: (
                          <div className="space-y-0.5">
                            {emailDetails.swiggy_order_info.items.map((item, idx) => (
                              <div key={idx} className="text-foreground">
                                {item.quantity ? `${item.quantity}× ` : ""}
                                {item.name}
                              </div>
                            ))}
                          </div>
                        ),
                      },
                      emailDetails.swiggy_order_info.delivery_address && {
                        label: "Address",
                        value: emailDetails.swiggy_order_info.delivery_address,
                      },
                      emailDetails.swiggy_order_info.order_id && {
                        label: "Order ID",
                        value: (
                          <span className="font-mono text-xs text-muted-foreground">
                            #{emailDetails.swiggy_order_info.order_id}
                          </span>
                        ),
                      },
                    ]}
                  />
                </ExpandedSection>
              )}

              {/* Full email body */}
              {emailDetails.raw_message?.payload && (
                <ExpandedSection
                  icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
                  title="Email Body"
                >
                  <div className="rounded-lg border border-border overflow-hidden">
                    <iframe
                      srcDoc={(() => {
                        const extractHtml = (payload: EmailPayload): string | null => {
                          if (
                            payload.mimeType === "text/html" &&
                            payload.body?.data
                          ) {
                            try {
                              return atob(
                                payload.body.data
                                  .replace(/-/g, "+")
                                  .replace(/_/g, "/")
                              );
                            } catch {
                              return null;
                            }
                          }
                          if (payload.parts) {
                            for (const part of payload.parts) {
                              const html = extractHtml(part);
                              if (html) return html;
                            }
                          }
                          return null;
                        };
                        const html = extractHtml(emailDetails.raw_message.payload);
                        return (
                          html ||
                          '<div style="padding:20px;text-align:center;color:#666">No HTML content available</div>'
                        );
                      })()}
                      className="w-full border-0"
                      style={{ height: "400px", maxHeight: "60vh" }}
                      sandbox="allow-same-origin"
                      title="Email content"
                    />
                  </div>
                </ExpandedSection>
              )}

              {/* Attachments */}
              {emailDetails.attachments && emailDetails.attachments.length > 0 && (
                <ExpandedSection
                  icon={<Package className="h-3.5 w-3.5 text-muted-foreground" />}
                  title={`Attachments (${emailDetails.attachments.length})`}
                >
                  <div className="space-y-1">
                    {emailDetails.attachments.map((attachment, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs bg-muted/40 rounded px-2.5 py-1.5"
                      >
                        <span className="truncate flex-1">{attachment.filename}</span>
                        <span className="text-muted-foreground/60 tabular-nums flex-shrink-0">
                          {(attachment.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                </ExpandedSection>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Failed to load email content
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Collapsed rich preview components ──────────────────────────────

function UberPreview({ info }: { info: NonNullable<EmailDetails["uber_trip_info"]> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {info.amount && (
        <span className="font-mono font-medium text-foreground tabular-nums">
          ₹{info.amount}
        </span>
      )}
      {info.vehicle_type && (
        <span className="text-muted-foreground">{info.vehicle_type}</span>
      )}
      {info.from_location && info.to_location && (
        <span className="text-muted-foreground truncate">
          {info.from_location} → {info.to_location}
        </span>
      )}
      {(info.distance || info.duration) && (
        <span className="text-muted-foreground/60">
          {[info.distance, info.duration].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}

function SwiggyPreview({ info }: { info: NonNullable<EmailDetails["swiggy_order_info"]> }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {info.amount && (
          <span className="font-mono font-medium text-foreground tabular-nums">
            ₹{info.amount}
          </span>
        )}
        {info.restaurant_name && (
          <span className="text-muted-foreground font-medium">{info.restaurant_name}</span>
        )}
        {info.order_type && (
          <span className="text-muted-foreground/60">{info.order_type}</span>
        )}
      </div>
      {info.order_id && (
        <p className="text-[10px] font-mono text-muted-foreground/50">
          Order #{info.order_id}
        </p>
      )}
    </div>
  );
}

// ── Expanded content helpers ────────────────────────────────────────

function ExpandedSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

type DetailRow = { label: string; value: React.ReactNode } | null | false | 0 | undefined | "";

function DetailGrid({ rows }: { rows: DetailRow[] }) {
  const filtered = rows.filter(Boolean) as { label: string; value: React.ReactNode }[];
  if (!filtered.length) return null;

  return (
    <div className="rounded-lg bg-muted/30 border border-border/50 divide-y divide-border/40 overflow-hidden">
      {filtered.map(({ label, value }) => (
        <div key={label} className="flex items-start gap-3 px-3 py-2 text-xs">
          <span className="text-muted-foreground/60 w-20 flex-shrink-0 pt-px">{label}</span>
          <span className="text-foreground flex-1 break-words min-w-0">{value}</span>
        </div>
      ))}
    </div>
  );
}
