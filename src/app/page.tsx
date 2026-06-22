"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function generateCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const CODE_REGEX = /^[a-z0-9]{4,16}$/;

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");

  function handleCreate() {
    const code = generateCode();
    router.push(`/meeting/${code}?host=1`);
  }

  function handleJoin() {
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    if (!CODE_REGEX.test(code)) {
      setError("Code must be 4-16 lowercase letters/numbers");
      return;
    }
    setError("");
    router.push(`/meeting/${code}`);
  }

  return (
    <main className="flex-1 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-blue-600/8 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-violet-600/8 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md space-y-10 relative z-10">
        {/* Logo + Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 mb-4 shadow-lg shadow-blue-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
              <rect x="2" y="6" width="14" height="12" rx="2" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">
            Quick Connect
          </h1>
          <p className="text-neutral-500 text-base">
            Instant video meetings, no sign-up needed
          </p>
        </div>

        {/* Card */}
        <div className="glass rounded-3xl p-6 space-y-5">
          <button
            onClick={handleCreate}
            className="group w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold transition-all duration-200 cursor-pointer shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 hover:scale-[1.01] active:scale-[0.99]"
          >
            <span className="flex items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              Create Meeting
            </span>
          </button>

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-700 to-transparent" />
            <span className="text-neutral-600 text-xs font-medium uppercase tracking-wider">or join</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-700 to-transparent" />
          </div>

          <div className="space-y-2.5">
            <div className="flex gap-2.5">
              <input
                type="text"
                placeholder="Enter meeting code"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                className={`flex-1 py-3.5 px-4 rounded-2xl bg-white/[0.04] border text-white placeholder-neutral-600 focus:outline-none transition-all duration-200 font-mono tracking-wide ${error ? "border-red-500/50 focus:border-red-500" : "border-white/[0.06] focus:border-blue-500/50 focus:bg-white/[0.06]"}`}
              />
              <button
                onClick={handleJoin}
                disabled={!joinCode.trim()}
                className="py-3.5 px-6 rounded-2xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] text-white font-medium transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                Join
              </button>
            </div>
            {error && (
              <p className="text-red-400/90 text-sm px-2 flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" x2="12" y1="8" y2="12" />
                  <line x1="12" x2="12.01" y1="16" y2="16" />
                </svg>
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Footer hint */}
        <p className="text-center text-neutral-700 text-xs">
          Peer-to-peer encrypted &middot; No data stored
        </p>
      </div>
    </main>
  );
}
