"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmailMetadata, EmailDetails, EmailPayload, SwiggyOrderInfo, MerchantInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Link2, Unlink, Mail, Calendar, User, Loader2, Car, UtensilsCrossed, Package, ShoppingBag } from "lucide-react";
import { format } from "date-fns";

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

  // Helper function to get merchant badge
  const getMerchantBadge = () => {
    const subject = email.subject?.toLowerCase() || "";
    const sender = email.sender?.toLowerCase() || "";
    const combined = `${subject} ${sender}`;

    if (combined.includes("uber")) return { icon: Car, name: "Uber" };
    if (combined.includes("ola")) return { icon: Car, name: "Ola" };
    if (combined.includes("swiggy")) return { icon: UtensilsCrossed, name: "Swiggy" };
    if (combined.includes("zomato")) return { icon: UtensilsCrossed, name: "Zomato" };
    if (combined.includes("amazon")) return { icon: Package, name: "Amazon" };
    if (combined.includes("flipkart")) return { icon: ShoppingBag, name: "Flipkart" };
    if (combined.includes("myntra")) return { icon: ShoppingBag, name: "Myntra" };
    if (combined.includes("bigbasket")) return { icon: ShoppingBag, name: "BigBasket" };
    return null;
  };

  const merchantBadge = getMerchantBadge();

  // Auto-fetch details for Uber and Swiggy emails to show info in card
  const isUberEmail = email.subject?.toLowerCase().includes("uber") ||
    email.sender?.toLowerCase().includes("uber");
  const isSwiggyEmail = email.subject?.toLowerCase().includes("swiggy") ||
    email.sender?.toLowerCase().includes("swiggy");

  // Fetch details on mount if it's an Uber or Swiggy email
  useEffect(() => {
    if ((isUberEmail || isSwiggyEmail) && !emailDetails && !isLoadingDetails) {
      setIsLoadingDetails(true);
      onFetchDetails(email.id)
        .then((details) => {
          setEmailDetails(details);
        })
        .catch(() => {
          // Silently ignore auto-fetch failures
        })
        .finally(() => {
          setIsLoadingDetails(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUberEmail, isSwiggyEmail, email.id]); // Only depend on these, emailDetails and isLoadingDetails are checked in condition

  const handleToggleExpand = async () => {
    if (!isExpanded && !emailDetails) {
      // Fetch email details when expanding for the first time
      setIsLoadingDetails(true);
      try {
        const details = await onFetchDetails(email.id);
        setEmailDetails(details);
      } catch {
        // Error expanding email details
      } finally {
        setIsLoadingDetails(false);
      }
    }
    setIsExpanded(!isExpanded);
  };

  const handleLinkToggle = async () => {
    setIsLinking(true);
    try {
      if (isLinked) {
        await onUnlink(email.id);
      } else {
        await onLink(email.id);
      }
    } catch {
      // Error handled by parent's onLink/onUnlink
    } finally {
      setIsLinking(false);
    }
  };

  // Parse and format date
  const formatEmailDate = (dateString: string) => {
    try {
      // Gmail date format: "Mon, 01 Jan 2024 12:00:00 +0530"
      const date = new Date(dateString);
      return format(date, "MMM dd, yyyy HH:mm");
    } catch {
      return dateString;
    }
  };

  // Extract sender name from email address
  const extractSenderName = (sender: string) => {
    // Format: "Name <email@domain.com>" or just "email@domain.com"
    const match = sender.match(/^([^<]+)</);
    if (match) {
      return match[1].trim();
    }
    return sender.split("@")[0];
  };

  return (
    <Card
      className={cn(
        "transition-all duration-200 w-full max-w-full overflow-hidden bg-card",
        isLinked
          ? "border-violet-400/50 bg-violet-400/5"
          : "border-border"
      )}
    >
      <CardHeader className="pb-3 overflow-hidden">
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <CardTitle className="text-sm font-semibold break-words">
                {email.subject || "(No Subject)"}
              </CardTitle>
              <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                {merchantBadge && (
                  <Badge
                    variant="outline"
                    className="text-xs px-1.5 py-0.5 bg-muted/50 border-border text-muted-foreground gap-1"
                    title={merchantBadge.name}
                  >
                    <merchantBadge.icon className="h-3 w-3" />
                    {merchantBadge.name}
                  </Badge>
                )}
                {email.account && (
                  <Badge
                    variant="outline"
                    className="text-xs px-1.5 py-0.5 bg-muted/50 border-border text-muted-foreground gap-1"
                    title={`From ${email.account} account`}
                  >
                    <Mail className="h-3 w-3" />
                    {email.account === "primary" ? "Primary" : "Secondary"}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground min-w-0 overflow-hidden">
              <div className="flex items-center gap-1 min-w-0">
                <User className="h-3 w-3 flex-shrink-0" />
                <span className="break-words min-w-0">{extractSenderName(email.sender)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3 flex-shrink-0" />
                <span>{formatEmailDate(email.date)}</span>
              </div>

              {/* Uber Trip Info Preview (shown in collapsed view) */}
              {emailDetails?.uber_trip_info && (
                <div className="mt-2 pt-2 border-t border-border min-w-0 overflow-hidden">
                  <div className="flex flex-col gap-1.5 w-full min-w-0">
                    {emailDetails.uber_trip_info.amount && (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono tabular-nums font-medium text-foreground">
                          ₹{emailDetails.uber_trip_info.amount}
                        </span>
                        {emailDetails.uber_trip_info.vehicle_type && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0">
                            {emailDetails.uber_trip_info.vehicle_type}
                          </Badge>
                        )}
                      </div>
                    )}
                    {(emailDetails.uber_trip_info.start_time || emailDetails.uber_trip_info.end_time) && (
                      <div className="text-muted-foreground">
                        {emailDetails.uber_trip_info.start_time}
                        {emailDetails.uber_trip_info.start_time && emailDetails.uber_trip_info.end_time && " → "}
                        {emailDetails.uber_trip_info.end_time}
                      </div>
                    )}
                    {emailDetails.uber_trip_info.from_location && (
                      <div className="text-gray-500 dark:text-gray-400 min-w-0 w-full overflow-hidden">
                        <span className="font-medium text-muted-foreground flex-shrink-0">From: </span>
                        <span className="break-words overflow-wrap-anywhere inline-block min-w-0">{emailDetails.uber_trip_info.from_location}</span>
                      </div>
                    )}
                    {emailDetails.uber_trip_info.to_location && (
                      <div className="text-gray-500 dark:text-gray-400 min-w-0 w-full overflow-hidden">
                        <span className="font-medium text-muted-foreground flex-shrink-0">To: </span>
                        <span className="break-words overflow-wrap-anywhere inline-block min-w-0">{emailDetails.uber_trip_info.to_location}</span>
                      </div>
                    )}
                    {(emailDetails.uber_trip_info.distance || emailDetails.uber_trip_info.duration) && (
                      <div className="text-muted-foreground/70 text-[10px]">
                        {emailDetails.uber_trip_info.distance}
                        {emailDetails.uber_trip_info.distance && emailDetails.uber_trip_info.duration && " • "}
                        {emailDetails.uber_trip_info.duration}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Swiggy Order Info Preview (shown in collapsed view) */}
              {emailDetails?.swiggy_order_info && (
                <div className="mt-2 pt-2 border-t border-border min-w-0 overflow-hidden">
                  <div className="flex flex-col gap-1.5 w-full min-w-0">
                    {emailDetails.swiggy_order_info.amount && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-foreground">
                          ₹{emailDetails.swiggy_order_info.amount}
                        </span>
                        {emailDetails.swiggy_order_info.restaurant_name && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0">
                            {emailDetails.swiggy_order_info.restaurant_name}
                          </Badge>
                        )}
                        {emailDetails.swiggy_order_info.order_type && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">
                            {emailDetails.swiggy_order_info.order_type}
                          </Badge>
                        )}
                      </div>
                    )}
                    {(emailDetails.swiggy_order_info.order_date || emailDetails.swiggy_order_info.order_time) && (
                      <div className="text-gray-500 dark:text-gray-400 text-xs">
                        {emailDetails.swiggy_order_info.order_date && `${emailDetails.swiggy_order_info.order_date} `}
                        {emailDetails.swiggy_order_info.order_time}
                      </div>
                    )}
                    {emailDetails.swiggy_order_info.order_id && (
                      <div className="text-muted-foreground/70 text-[10px]">
                        Order #{emailDetails.swiggy_order_info.order_id}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Loading indicator for merchant emails */}
              {(isUberEmail || isSwiggyEmail) && isLoadingDetails && !emailDetails && (
                <div className="mt-2 pt-2 border-t border-border">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Loading details...</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2 flex-shrink-0">
            {isLinked ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLinkToggle}
                disabled={isLinking}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-[#F44D4D] hover:bg-[#F44D4D]/10 border border-border/50 bg-muted/20 rounded-md"
                aria-label="Unlink email"
              >
                {isLinking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Unlink className="h-3.5 w-3.5" />
                )}
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleLinkToggle}
                disabled={isLinking}
                className="h-8"
              >
                {isLinking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Link2 className="h-3.5 w-3.5 mr-1" />
                    Link
                  </>
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleExpand}
              className="h-8 w-8 p-0"
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0 overflow-hidden max-w-full">
          {isLoadingDetails ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading email content...</span>
            </div>
          ) : emailDetails ? (
            <div className="space-y-3">


              {/* Uber Trip Info */}
              {emailDetails.uber_trip_info && (
                <div className="text-sm border-t pt-3">
                  <div className="font-medium mb-3 flex items-center gap-2 text-foreground">
                    <Car className="h-4 w-4 text-violet-300" />
                    Trip Details
                  </div>
                  <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
                    {emailDetails.uber_trip_info.amount && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-violet-300 min-w-[80px]">Amount:</span>
                        <span className="font-mono tabular-nums text-foreground">₹{emailDetails.uber_trip_info.amount}</span>
                      </div>
                    )}
                    {(emailDetails.uber_trip_info.start_time || emailDetails.uber_trip_info.end_time) && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-violet-300 min-w-[80px]">Time:</span>
                        <span className="text-foreground">
                          {emailDetails.uber_trip_info.start_time}
                          {emailDetails.uber_trip_info.start_time && emailDetails.uber_trip_info.end_time && " → "}
                          {emailDetails.uber_trip_info.end_time}
                        </span>
                      </div>
                    )}
                    {emailDetails.uber_trip_info.from_location && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-violet-300 min-w-[80px] flex-shrink-0">From:</span>
                        <span className="text-foreground break-words overflow-wrap-anywhere flex-1 min-w-0">{emailDetails.uber_trip_info.from_location}</span>
                      </div>
                    )}
                    {emailDetails.uber_trip_info.to_location && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-violet-300 min-w-[80px] flex-shrink-0">To:</span>
                        <span className="text-foreground break-words overflow-wrap-anywhere flex-1 min-w-0">{emailDetails.uber_trip_info.to_location}</span>
                      </div>
                    )}
                    {(emailDetails.uber_trip_info.distance || emailDetails.uber_trip_info.duration) && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-violet-300 min-w-[80px]">Distance:</span>
                        <span className="text-foreground">
                          {emailDetails.uber_trip_info.distance}
                          {emailDetails.uber_trip_info.distance && emailDetails.uber_trip_info.duration && " • "}
                          {emailDetails.uber_trip_info.duration}
                        </span>
                      </div>
                    )}
                    {emailDetails.uber_trip_info.vehicle_type && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-violet-300 min-w-[80px]">Vehicle:</span>
                        <span className="text-foreground">{emailDetails.uber_trip_info.vehicle_type}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Swiggy Order Info */}
              {emailDetails.swiggy_order_info && (
                <div className="text-sm border-t pt-3">
                  <div className="font-medium mb-3 flex items-center gap-2 text-foreground">
                    <UtensilsCrossed className="h-4 w-4 text-amber-300" />
                    Order Details
                    {emailDetails.swiggy_order_info.order_type && (
                      <Badge variant="secondary" className="text-xs">
                        {emailDetails.swiggy_order_info.order_type}
                      </Badge>
                    )}
                  </div>
                  <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
                    {emailDetails.swiggy_order_info.restaurant_name && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-amber-300 min-w-[100px]">Restaurant:</span>
                        <span className="text-foreground">{emailDetails.swiggy_order_info.restaurant_name}</span>
                      </div>
                    )}
                    {emailDetails.swiggy_order_info.amount && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-amber-300 min-w-[100px]">Amount:</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-foreground">₹{emailDetails.swiggy_order_info.amount}</span>
                          {emailDetails.swiggy_order_info.savings && (
                            <Badge variant="outline" className="text-xs bg-emerald-400/15 border-emerald-400/30 text-emerald-300">
                              Saved ₹{emailDetails.swiggy_order_info.savings}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                    {(emailDetails.swiggy_order_info.order_date || emailDetails.swiggy_order_info.order_time) && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-amber-300 min-w-[100px]">Date/Time:</span>
                        <span className="text-foreground">
                          {emailDetails.swiggy_order_info.order_date && `${emailDetails.swiggy_order_info.order_date} `}
                          {emailDetails.swiggy_order_info.order_time}
                        </span>
                      </div>
                    )}
                    {emailDetails.swiggy_order_info.num_diners && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-amber-300 min-w-[100px]">Diners:</span>
                        <span className="text-foreground">{emailDetails.swiggy_order_info.num_diners} {emailDetails.swiggy_order_info.num_diners === 1 ? 'person' : 'people'}</span>
                      </div>
                    )}
                    {emailDetails.swiggy_order_info.items && emailDetails.swiggy_order_info.items.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-amber-300 min-w-[100px] flex-shrink-0">Items:</span>
                        <div className="flex-1 space-y-1">
                          {emailDetails.swiggy_order_info.items.map((item, idx) => (
                            <div key={idx} className="text-foreground text-sm">
                              {item.quantity && `${item.quantity}x `}{item.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {emailDetails.swiggy_order_info.delivery_address && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-amber-300 min-w-[100px] flex-shrink-0">Address:</span>
                        <span className="text-foreground break-words overflow-wrap-anywhere flex-1 min-w-0">{emailDetails.swiggy_order_info.delivery_address}</span>
                      </div>
                    )}
                    {emailDetails.swiggy_order_info.order_id && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-amber-300 min-w-[100px]">Order ID:</span>
                        <span className="text-foreground">{emailDetails.swiggy_order_info.order_id}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {emailDetails.raw_message?.payload && (
                <div className="text-sm text-gray-700 dark:text-gray-300 border-t pt-3 overflow-hidden">
                  <div className="font-medium mb-2">Full Email Body:</div>
                  <div className="bg-background rounded border border-border overflow-hidden">
                    <iframe
                      srcDoc={(() => {
                        const extractHtml = (payload: EmailPayload): string | null => {
                          if (payload.mimeType === 'text/html' && payload.body?.data) {
                            try {
                              return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                            } catch (e) {
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
                        const htmlContent = extractHtml(emailDetails.raw_message.payload);
                        return htmlContent || '<div style="padding: 20px; text-align: center; color: #666;">No HTML content available</div>';
                      })()}
                      className="w-full border-0"
                      style={{ height: '400px', maxHeight: '60vh' }}
                      sandbox="allow-same-origin"
                      title="Email content"
                    />
                  </div>
                </div>
              )}

              {emailDetails.attachments && emailDetails.attachments.length > 0 && (
                <div className="text-sm border-t pt-3">
                  <div className="font-medium mb-2">
                    Attachments ({emailDetails.attachments.length}):
                  </div>
                  <div className="space-y-1">
                    {emailDetails.attachments.map((attachment, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs bg-muted/50 p-2 rounded"
                      >
                        <span className="truncate flex-1">{attachment.filename}</span>
                        <Badge variant="outline" className="text-xs">
                          {(attachment.size / 1024).toFixed(1)} KB
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Failed to load email content
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

