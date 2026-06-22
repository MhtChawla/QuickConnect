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

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");

  function handleCreate() {
    const code = generateCode();
    router.push(`/meeting/${code}?host=1`);
  }

  function handleJoin() {
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    router.push(`/meeting/${code}`);
  }

  return (
    <main className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Quick Connect</h1>
          <p className="text-neutral-400">Instant video meetings, no sign-up needed</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleCreate}
            className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors cursor-pointer"
          >
            Create Meeting
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-neutral-700" />
            <span className="text-neutral-500 text-sm">or join one</span>
            <div className="flex-1 h-px bg-neutral-700" />
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter meeting code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              className="flex-1 py-3 px-4 rounded-xl bg-neutral-800 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button
              onClick={handleJoin}
              disabled={!joinCode.trim()}
              className="py-3 px-6 rounded-xl bg-neutral-700 hover:bg-neutral-600 text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Join
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
