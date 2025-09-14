"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, Plus, Calculator } from "lucide-react";
import { SplitBreakdown } from "@/lib/types";

interface SplitEditorProps {
  amount: number;
  splitBreakdown?: SplitBreakdown;
  onSave: (splitBreakdown: SplitBreakdown) => void;
  onCancel: () => void;
}

export function SplitEditor({ amount, splitBreakdown, onSave, onCancel }: SplitEditorProps) {
  const [mode, setMode] = useState<"equal" | "custom">(splitBreakdown?.mode || "equal");
  const [participants, setParticipants] = useState<string[]>(
    splitBreakdown?.participants || []
  );
  const [customAmounts, setCustomAmounts] = useState<Record<string, number>>(
    splitBreakdown?.custom_amounts || {}
  );
  const [includeMe, setIncludeMe] = useState(splitBreakdown?.include_me || false);
  const [newParticipant, setNewParticipant] = useState("");

  const addParticipant = () => {
    if (newParticipant.trim() && !participants.includes(newParticipant.trim())) {
      const updatedParticipants = [...participants, newParticipant.trim()];
      setParticipants(updatedParticipants);
      setNewParticipant("");
      
      // Initialize custom amount if in custom mode
      if (mode === "custom") {
        setCustomAmounts(prev => ({
          ...prev,
          [newParticipant.trim()]: 0
        }));
      }
    }
  };

  const removeParticipant = (participant: string) => {
    setParticipants(prev => prev.filter(p => p !== participant));
    setCustomAmounts(prev => {
      const updated = { ...prev };
      delete updated[participant];
      return updated;
    });
  };

  const updateCustomAmount = (participant: string, amount: number) => {
    setCustomAmounts(prev => ({
      ...prev,
      [participant]: amount
    }));
  };

  const calculateEqualSplit = () => {
    const totalParticipants = participants.length + (includeMe ? 1 : 0);
    return totalParticipants > 0 ? amount / totalParticipants : 0;
  };

  const calculateCustomTotal = () => {
    const participantTotal = Object.values(customAmounts).reduce((sum, amt) => sum + amt, 0);
    const myAmount = includeMe ? (customAmounts["me"] || 0) : 0;
    return participantTotal + myAmount;
  };

  const calculateMyShare = () => {
    if (mode === "equal") {
      return includeMe ? calculateEqualSplit() : 0;
    } else {
      return includeMe ? (customAmounts["me"] || 0) : 0;
    }
  };

  const handleSave = () => {
    const splitBreakdown: SplitBreakdown = {
      mode,
      participants,
      include_me: includeMe,
      ...(mode === "custom" && { custom_amounts: customAmounts })
    };
    onSave(splitBreakdown);
  };

  const equalSplitAmount = calculateEqualSplit();
  const customTotal = calculateCustomTotal();
  const myShare = calculateMyShare();
  const isCustomValid = mode === "equal" || Math.abs(customTotal - amount) < 0.01;

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Split Transaction
        </CardTitle>
        <div className="text-sm text-gray-600">
          Total Amount: ₹{amount.toLocaleString()}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={mode} onValueChange={(value) => setMode(value as "equal" | "custom")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="equal">Equal Split</TabsTrigger>
            <TabsTrigger value="custom">Custom Split</TabsTrigger>
          </TabsList>
          
          <TabsContent value="equal" className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="include-me"
                  checked={includeMe}
                  onCheckedChange={setIncludeMe}
                />
                <Label htmlFor="include-me">Include me in the split</Label>
              </div>
              
              <div className="space-y-2">
                <Label>Participants</Label>
                <div className="flex gap-2">
                  <Input
                    value={newParticipant}
                    onChange={(e) => setNewParticipant(e.target.value)}
                    placeholder="Add participant name"
                    onKeyPress={(e) => e.key === "Enter" && addParticipant()}
                  />
                  <Button onClick={addParticipant} disabled={!newParticipant.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Current Participants</Label>
                <div className="flex flex-wrap gap-2">
                  {participants.map((participant) => (
                    <Badge key={participant} variant="outline" className="flex items-center gap-1">
                      {participant}
                      <X
                        className="h-3 w-3 cursor-pointer hover:text-red-500"
                        onClick={() => removeParticipant(participant)}
                      />
                    </Badge>
                  ))}
                </div>
              </div>
              
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm font-medium text-blue-900 mb-2">Split Preview</div>
                <div className="space-y-1 text-sm">
                  <div>Total participants: {participants.length + (includeMe ? 1 : 0)}</div>
                  <div>Amount per person: ₹{equalSplitAmount.toLocaleString()}</div>
                  {includeMe && (
                    <div className="font-medium text-blue-700">
                      Your share: ₹{myShare.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="custom" className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="include-me-custom"
                  checked={includeMe}
                  onCheckedChange={setIncludeMe}
                />
                <Label htmlFor="include-me-custom">Include me in the split</Label>
              </div>
              
              <div className="space-y-2">
                <Label>Participants</Label>
                <div className="flex gap-2">
                  <Input
                    value={newParticipant}
                    onChange={(e) => setNewParticipant(e.target.value)}
                    placeholder="Add participant name"
                    onKeyPress={(e) => e.key === "Enter" && addParticipant()}
                  />
                  <Button onClick={addParticipant} disabled={!newParticipant.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Custom Amounts</Label>
                <div className="space-y-2">
                  {participants.map((participant) => (
                    <div key={participant} className="flex items-center gap-2">
                      <span className="w-24 text-sm">{participant}:</span>
                      <Input
                        type="number"
                        value={customAmounts[participant] || 0}
                        onChange={(e) => updateCustomAmount(participant, Number(e.target.value))}
                        className="flex-1"
                      />
                      <X
                        className="h-4 w-4 cursor-pointer hover:text-red-500"
                        onClick={() => removeParticipant(participant)}
                      />
                    </div>
                  ))}
                  {includeMe && (
                    <div className="flex items-center gap-2">
                      <span className="w-24 text-sm font-medium">Me:</span>
                      <Input
                        type="number"
                        value={customAmounts["me"] || 0}
                        onChange={(e) => updateCustomAmount("me", Number(e.target.value))}
                        className="flex-1"
                      />
                    </div>
                  )}
                </div>
              </div>
              
              <div className={`p-4 rounded-lg ${isCustomValid ? "bg-green-50" : "bg-red-50"}`}>
                <div className={`text-sm font-medium mb-2 ${isCustomValid ? "text-green-900" : "text-red-900"}`}>
                  Split Summary
                </div>
                <div className="space-y-1 text-sm">
                  <div>Custom total: ₹{customTotal.toLocaleString()}</div>
                  <div>Transaction amount: ₹{amount.toLocaleString()}</div>
                  <div className={`font-medium ${isCustomValid ? "text-green-700" : "text-red-700"}`}>
                    {isCustomValid ? "✓ Amounts match!" : `⚠ Difference: ₹${Math.abs(customTotal - amount).toLocaleString()}`}
                  </div>
                  {includeMe && (
                    <div className="font-medium text-green-700">
                      Your share: ₹{myShare.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave}
            disabled={mode === "custom" && !isCustomValid}
          >
            Apply Split
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
