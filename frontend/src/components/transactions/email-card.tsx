"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmailMetadata, EmailDetails } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Link2, Unlink, Mail, Calendar, User, Loader2 } from "lucide-react";
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
  
  // Auto-fetch details for Uber emails to show trip info in card
  const isUberEmail = email.subject?.toLowerCase().includes("uber") || 
                       email.sender?.toLowerCase().includes("uber");
  
  // Fetch details on mount if it's an Uber email
  useEffect(() => {
    if (isUberEmail && !emailDetails && !isLoadingDetails) {
      setIsLoadingDetails(true);
      onFetchDetails(email.id)
        .then((details) => {
          setEmailDetails(details);
        })
        .catch((error) => {
          console.error("Failed to fetch Uber email details:", error);
        })
        .finally(() => {
          setIsLoadingDetails(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUberEmail, email.id]); // Only depend on these, emailDetails and isLoadingDetails are checked in condition

  const handleToggleExpand = async () => {
    if (!isExpanded && !emailDetails) {
      // Fetch email details when expanding for the first time
      setIsLoadingDetails(true);
      try {
        const details = await onFetchDetails(email.id);
        setEmailDetails(details);
      } catch (error) {
        console.error("Failed to fetch email details:", error);
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
    } catch (error) {
      console.error("Failed to link/unlink email:", error);
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
        "transition-all duration-200 w-full max-w-full overflow-hidden",
        isLinked
          ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/20"
          : "border-gray-200 dark:border-gray-700"
      )}
    >
      <CardHeader className="pb-3 overflow-hidden">
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <Mail className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <CardTitle className="text-sm font-semibold break-words">
                {email.subject || "(No Subject)"}
              </CardTitle>
              <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                {email.account && (
                  <Badge 
                    variant="outline" 
                    className="text-xs"
                    title={`From ${email.account} account`}
                  >
                    {email.account === "primary" ? "📧1" : "📧2"}
                  </Badge>
                )}
                {isLinked && (
                  <Badge variant="secondary">
                    Linked
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400 min-w-0 overflow-hidden">
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
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 min-w-0 overflow-hidden">
                  <div className="flex flex-col gap-1.5 w-full min-w-0">
                    {emailDetails.uber_trip_info.amount && (
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
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
                      <div className="text-gray-500 dark:text-gray-400">
                        {emailDetails.uber_trip_info.start_time}
                        {emailDetails.uber_trip_info.start_time && emailDetails.uber_trip_info.end_time && " → "}
                        {emailDetails.uber_trip_info.end_time}
                      </div>
                    )}
                    {emailDetails.uber_trip_info.from_location && (
                      <div className="text-gray-500 dark:text-gray-400 min-w-0 w-full overflow-hidden">
                        <span className="font-medium text-gray-600 dark:text-gray-300 flex-shrink-0">From: </span>
                        <span className="break-words overflow-wrap-anywhere inline-block min-w-0">{emailDetails.uber_trip_info.from_location}</span>
                      </div>
                    )}
                    {emailDetails.uber_trip_info.to_location && (
                      <div className="text-gray-500 dark:text-gray-400 min-w-0 w-full overflow-hidden">
                        <span className="font-medium text-gray-600 dark:text-gray-300 flex-shrink-0">To: </span>
                        <span className="break-words overflow-wrap-anywhere inline-block min-w-0">{emailDetails.uber_trip_info.to_location}</span>
                      </div>
                    )}
                    {(emailDetails.uber_trip_info.distance || emailDetails.uber_trip_info.duration) && (
                      <div className="text-gray-400 dark:text-gray-500 text-[10px]">
                        {emailDetails.uber_trip_info.distance}
                        {emailDetails.uber_trip_info.distance && emailDetails.uber_trip_info.duration && " • "}
                        {emailDetails.uber_trip_info.duration}
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Loading indicator for Uber email */}
              {isUberEmail && isLoadingDetails && !emailDetails && (
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Loading trip details...</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant={isLinked ? "destructive" : "default"}
              size="sm"
              onClick={handleLinkToggle}
              disabled={isLinking}
              className="h-8"
            >
              {isLinking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isLinked ? (
                <>
                  <Unlink className="h-3.5 w-3.5 mr-1" />
                  Unlink
                </>
              ) : (
                <>
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                  Link
                </>
              )}
            </Button>
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
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              <span className="ml-2 text-sm text-gray-500">Loading email content...</span>
            </div>
          ) : emailDetails ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-600 dark:text-gray-400 border-t pt-3">
                <div className="font-medium mb-1">Preview:</div>
                <div className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded">
                  {email.snippet}
                </div>
              </div>

              {/* Uber Trip Info */}
              {emailDetails.uber_trip_info && (
                <div className="text-sm border-t pt-3">
                  <div className="font-medium mb-3 flex items-center gap-2">
                    🚗 Trip Details
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
                    {emailDetails.uber_trip_info.amount && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-blue-700 dark:text-blue-300 min-w-[80px]">Amount:</span>
                        <span className="text-blue-900 dark:text-blue-100">₹{emailDetails.uber_trip_info.amount}</span>
                      </div>
                    )}
                    {(emailDetails.uber_trip_info.start_time || emailDetails.uber_trip_info.end_time) && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-blue-700 dark:text-blue-300 min-w-[80px]">Time:</span>
                        <span className="text-blue-900 dark:text-blue-100">
                          {emailDetails.uber_trip_info.start_time}
                          {emailDetails.uber_trip_info.start_time && emailDetails.uber_trip_info.end_time && " → "}
                          {emailDetails.uber_trip_info.end_time}
                        </span>
                      </div>
                    )}
                    {emailDetails.uber_trip_info.from_location && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-blue-700 dark:text-blue-300 min-w-[80px] flex-shrink-0">From:</span>
                        <span className="text-blue-900 dark:text-blue-100 break-words overflow-wrap-anywhere flex-1 min-w-0">{emailDetails.uber_trip_info.from_location}</span>
                      </div>
                    )}
                    {emailDetails.uber_trip_info.to_location && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-blue-700 dark:text-blue-300 min-w-[80px] flex-shrink-0">To:</span>
                        <span className="text-blue-900 dark:text-blue-100 break-words overflow-wrap-anywhere flex-1 min-w-0">{emailDetails.uber_trip_info.to_location}</span>
                      </div>
                    )}
                    {(emailDetails.uber_trip_info.distance || emailDetails.uber_trip_info.duration) && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-blue-700 dark:text-blue-300 min-w-[80px]">Distance:</span>
                        <span className="text-blue-900 dark:text-blue-100">
                          {emailDetails.uber_trip_info.distance}
                          {emailDetails.uber_trip_info.distance && emailDetails.uber_trip_info.duration && " • "}
                          {emailDetails.uber_trip_info.duration}
                        </span>
                      </div>
                    )}
                    {emailDetails.uber_trip_info.vehicle_type && (
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-blue-700 dark:text-blue-300 min-w-[80px]">Vehicle:</span>
                        <span className="text-blue-900 dark:text-blue-100">{emailDetails.uber_trip_info.vehicle_type}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="text-sm text-gray-700 dark:text-gray-300 border-t pt-3 overflow-hidden">
                <div className="font-medium mb-2">Full Email Body:</div>
                {emailDetails.body && emailDetails.body.trim() ? (
                  <div
                    className="text-xs bg-white dark:bg-gray-900 p-4 rounded border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto overflow-x-hidden"
                    style={{ 
                      lineHeight: "1.6",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      overflowWrap: "break-word"
                    }}
                  >
                    {emailDetails.body.split('\n').map((line, idx) => {
                      // Filter out CSS-like lines
                      const isCssLine = /^@(media|font-face|import|keyframes|page|charset|namespace)/i.test(line.trim()) ||
                                       /^@[a-z-]+\s*\{/i.test(line.trim()) ||
                                       (line.includes('@media') && line.includes('{'));
                      if (isCssLine) return null;
                      return (
                        <div key={idx} className={line.startsWith('•') ? 'ml-2' : ''}>
                          {line || '\u00A0'}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs bg-gray-50 dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700 text-center text-gray-500">
                    <p>No readable text content available</p>
                    <p className="mt-1 text-xs">
                      {emailDetails.attachments && emailDetails.attachments.length > 0 
                        ? "This email may contain only images or formatted content. Check attachments below."
                        : "This email may contain only images or formatted content."}
                    </p>
                  </div>
                )}
              </div>

              {emailDetails.attachments && emailDetails.attachments.length > 0 && (
                <div className="text-sm border-t pt-3">
                  <div className="font-medium mb-2">
                    Attachments ({emailDetails.attachments.length}):
                  </div>
                  <div className="space-y-1">
                    {emailDetails.attachments.map((attachment, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded"
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
            <div className="text-sm text-gray-500 py-4 text-center">
              Failed to load email content
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

