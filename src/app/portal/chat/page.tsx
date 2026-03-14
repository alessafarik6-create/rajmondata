
"use client";

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, Send, Plus, MoreHorizontal, Smile, Paperclip } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ChatPage() {
  const [message, setMessage] = useState('');
  
  const contacts = [
    { id: '1', name: 'General Channel', type: 'channel', lastMsg: 'Alex: We updated the project...', active: true },
    { id: '2', name: 'Management', type: 'channel', lastMsg: 'Sarah: Please review the docs', active: false },
    { id: '3', name: 'Sarah Miller', type: 'direct', lastMsg: 'Can we talk later?', active: false, avatar: 'https://picsum.photos/seed/sarah/100/100' },
    { id: '4', name: 'Mike Thompson', type: 'direct', lastMsg: 'The report is ready.', active: false, avatar: 'https://picsum.photos/seed/mike/100/100' },
  ];

  const messages = [
    { id: '1', user: 'Alex Thompson', content: 'Hey team, did everyone see the update for Job #12?', time: '09:45 AM', self: false },
    { id: '2', user: 'You', content: 'Yes, looking good. I will start the implementation today.', time: '10:02 AM', self: true },
    { id: '3', user: 'Sarah Miller', content: 'Awesome! Let me know if you need any assets.', time: '10:05 AM', self: false },
  ];

  return (
    <div className="h-[calc(100vh-160px)] flex gap-6 overflow-hidden">
      {/* Sidebar */}
      <Card className="w-80 bg-surface border-border flex flex-col shrink-0">
        <div className="p-4 border-b">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search messages..." className="pl-10 bg-background border-border" />
          </div>
          <Button variant="outline" className="w-full justify-between">
            New Chat <Plus className="w-4 h-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {contacts.map((contact) => (
              <button
                key={contact.id}
                className={`w-full text-left p-3 rounded-md transition-colors ${contact.active ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`}
              >
                <div className="flex items-center gap-3">
                  {contact.type === 'channel' ? (
                    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center font-bold text-lg">#</div>
                  ) : (
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={contact.avatar} />
                      <AvatarFallback>{contact.name[0]}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{contact.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{contact.lastMsg}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Card>

      {/* Main Chat Area */}
      <Card className="flex-1 bg-surface border-border flex flex-col overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center font-bold text-lg">#</div>
            <div>
              <h3 className="font-bold">General Channel</h3>
              <p className="text-xs text-muted-foreground">Team-wide discussions</p>
            </div>
          </div>
          <Button variant="ghost" size="icon"><MoreHorizontal className="w-5 h-5" /></Button>
        </div>

        <ScrollArea className="flex-1 p-6">
          <div className="space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-4 ${msg.self ? 'flex-row-reverse' : ''}`}>
                {!msg.self && (
                  <Avatar className="w-8 h-8 shrink-0 mt-1">
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">{msg.user[0]}</AvatarFallback>
                  </Avatar>
                )}
                <div className={`max-w-[70%] ${msg.self ? 'items-end' : ''} flex flex-col gap-1`}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-bold">{msg.self ? 'You' : msg.user}</span>
                    <span className="text-[10px] text-muted-foreground">{msg.time}</span>
                  </div>
                  <div className={`p-3 rounded-2xl text-sm ${msg.self ? 'bg-primary text-white rounded-tr-none' : 'bg-muted text-foreground rounded-tl-none'}`}>
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="p-4 border-t bg-background/30">
          <div className="flex items-center gap-2 bg-background border border-border rounded-lg p-1 pr-3 shadow-inner focus-within:ring-1 focus-within:ring-primary">
            <Button variant="ghost" size="icon" className="text-muted-foreground"><Smile className="w-5 h-5" /></Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground"><Paperclip className="w-5 h-5" /></Button>
            <Input 
              placeholder="Type your message..." 
              className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-10"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && message && (setMessage(''))}
            />
            <Button 
              size="icon" 
              className="bg-primary hover:bg-secondary h-8 w-8"
              disabled={!message}
              onClick={() => setMessage('')}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
