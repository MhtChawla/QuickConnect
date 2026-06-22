"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import Peer, { MediaConnection, DataConnection } from "peerjs";

interface RemotePeer {
  peerId: string;
  stream: MediaStream | null;
  mediaConn: MediaConnection | null;
  dataConn: DataConnection | null;
}

type RoomState = "connecting" | "connected" | "invalid" | "error";

export default function MeetingRoom() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = params.code as string;
  const isHost = searchParams.get("host") === "1";

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remotePeersRef = useRef<Map<string, RemotePeer>>(new Map());
  const hostRespondedRef = useRef(false);
  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeer>>(new Map());
  const [roomState, setRoomState] = useState<RoomState>("connecting");
  const [status, setStatus] = useState("Initializing...");
  const [errorMsg, setErrorMsg] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState("");

  const rosterRef = useRef<Set<string>>(new Set());

  const syncState = useCallback(() => {
    setRemotePeers(new Map(remotePeersRef.current));
  }, []);

  const markHostResponded = useCallback(() => {
    if (hostRespondedRef.current) return;
    hostRespondedRef.current = true;
    if (joinTimeoutRef.current) {
      clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
    setRoomState("connected");
  }, []);

  const broadcastRoster = useCallback(() => {
    const roster = Array.from(rosterRef.current);
    remotePeersRef.current.forEach((rp) => {
      if (rp.dataConn?.open) {
        rp.dataConn.send({ type: "roster", peers: roster });
      }
    });
  }, []);

  const callPeer = useCallback((remotePeerId: string) => {
    const peer = peerRef.current;
    const localStream = localStreamRef.current;
    if (!peer || !localStream || remotePeersRef.current.has(remotePeerId)) return;

    const entry: RemotePeer = { peerId: remotePeerId, stream: null, mediaConn: null, dataConn: null };
    remotePeersRef.current.set(remotePeerId, entry);
    syncState();

    const mediaConn = peer.call(remotePeerId, localStream);
    entry.mediaConn = mediaConn;
    mediaConn.on("stream", (remoteStream) => {
      entry.stream = remoteStream;
      markHostResponded();
      syncState();
    });
    mediaConn.on("close", () => {
      remotePeersRef.current.delete(remotePeerId);
      rosterRef.current.delete(remotePeerId);
      syncState();
      broadcastRoster();
    });
    mediaConn.on("error", () => {
      remotePeersRef.current.delete(remotePeerId);
      rosterRef.current.delete(remotePeerId);
      syncState();
      broadcastRoster();
    });

    const dataConn = peer.connect(remotePeerId);
    entry.dataConn = dataConn;
    dataConn.on("open", () => {
      markHostResponded();
    });
    dataConn.on("data", (data: unknown) => {
      const msg = data as { type: string; peers?: string[] };
      if (msg.type === "roster" && msg.peers) {
        handleRoster(msg.peers);
      }
    });
    dataConn.on("close", () => {
      remotePeersRef.current.delete(remotePeerId);
      rosterRef.current.delete(remotePeerId);
      syncState();
      broadcastRoster();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncState, broadcastRoster, markHostResponded]);

  const handleRoster = useCallback((peers: string[]) => {
    const myId = peerRef.current?.id;
    if (!myId) return;
    peers.forEach((pid) => {
      if (pid !== myId && !remotePeersRef.current.has(pid)) {
        callPeer(pid);
      }
    });
  }, [callPeer]);

  useEffect(() => {
    let destroyed = false;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (destroyed) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch {
        setErrorMsg("Camera/mic access denied. Please allow access and try again.");
        setRoomState("error");
        return;
      }

      const myPeerId = isHost ? code : `${code}-${Math.random().toString(36).slice(2, 10)}`;
      setStatus("Connecting to signaling server...");

      const peer = new Peer(myPeerId);
      peerRef.current = peer;

      peer.on("open", (id) => {
        if (destroyed) return;
        if (isHost) {
          rosterRef.current.add(id);
          setRoomState("connected");
          setStatus("Waiting for others to join...");
        } else {
          setStatus("Connecting to meeting...");
          callPeer(code);
          joinTimeoutRef.current = setTimeout(() => {
            if (!hostRespondedRef.current) {
              setRoomState("invalid");
            }
          }, 8000);
        }
      });

      peer.on("error", (err) => {
        if (destroyed) return;
        if (err.type === "unavailable-id" && isHost) {
          setStatus("Room code taken, retrying...");
          peer.destroy();
          const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
          let newCode = "";
          for (let i = 0; i < 8; i++) newCode += chars[Math.floor(Math.random() * chars.length)];
          router.replace(`/meeting/${newCode}?host=1`);
          return;
        }
        if (err.type === "peer-unavailable" && !isHost) {
          if (!hostRespondedRef.current) {
            setRoomState("invalid");
          }
          return;
        }
        setStatus(`Connection error: ${err.type}`);
      });

      peer.on("call", (mediaConn) => {
        if (destroyed) return;
        const remotePeerId = mediaConn.peer;
        mediaConn.answer(localStreamRef.current!);

        let entry = remotePeersRef.current.get(remotePeerId);
        if (!entry) {
          entry = { peerId: remotePeerId, stream: null, mediaConn: null, dataConn: null };
          remotePeersRef.current.set(remotePeerId, entry);
        }
        entry.mediaConn = mediaConn;

        mediaConn.on("stream", (remoteStream) => {
          entry!.stream = remoteStream;
          syncState();
          setStatus("");
        });
        mediaConn.on("close", () => {
          remotePeersRef.current.delete(remotePeerId);
          rosterRef.current.delete(remotePeerId);
          syncState();
          if (isHost) broadcastRoster();
        });
        mediaConn.on("error", () => {
          remotePeersRef.current.delete(remotePeerId);
          rosterRef.current.delete(remotePeerId);
          syncState();
          if (isHost) broadcastRoster();
        });

        if (isHost) {
          rosterRef.current.add(remotePeerId);
          broadcastRoster();
        }

        syncState();
      });

      peer.on("connection", (dataConn) => {
        if (destroyed) return;
        const remotePeerId = dataConn.peer;
        let entry = remotePeersRef.current.get(remotePeerId);
        if (!entry) {
          entry = { peerId: remotePeerId, stream: null, mediaConn: null, dataConn: null };
          remotePeersRef.current.set(remotePeerId, entry);
        }
        entry.dataConn = dataConn;

        dataConn.on("data", (data: unknown) => {
          const msg = data as { type: string; peers?: string[] };
          if (msg.type === "roster" && msg.peers) {
            handleRoster(msg.peers);
          }
        });
        dataConn.on("close", () => {
          remotePeersRef.current.delete(remotePeerId);
          rosterRef.current.delete(remotePeerId);
          syncState();
          if (isHost) broadcastRoster();
        });

        if (isHost) {
          rosterRef.current.add(remotePeerId);
          dataConn.on("open", () => {
            broadcastRoster();
          });
        }
      });

      peer.on("disconnected", () => {
        if (!destroyed) peer.reconnect();
      });
    }

    init();

    const handleBeforeUnload = () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      peerRef.current?.destroy();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      destroyed = true;
      if (joinTimeoutRef.current) clearTimeout(joinTimeoutRef.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      remotePeersRef.current.forEach((rp) => {
        rp.mediaConn?.close();
        rp.dataConn?.close();
      });
      remotePeersRef.current.clear();
      peerRef.current?.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, isHost]);

  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [roomState]);

  function toggleMic() {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMicOn((v) => !v);
  }

  function toggleCam() {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCamOn((v) => !v);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  function copyCode() {
    try { navigator.clipboard.writeText(code).catch(() => {}); } catch {}
    setCopied(true);
    showToast(`Code "${code}" copied to clipboard`);
    setTimeout(() => setCopied(false), 2000);
  }

  function leave() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    remotePeersRef.current.forEach((rp) => {
      rp.mediaConn?.close();
      rp.dataConn?.close();
    });
    peerRef.current?.destroy();
    router.push("/");
  }

  // --- Screens ---

  if (roomState === "invalid") {
    return (
      <CenteredScreen>
        <div className="relative w-20 h-20 mx-auto mb-2">
          <div className="absolute inset-0 rounded-full bg-red-500/10 animate-pulse-ring" />
          <div className="relative w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" x2="9" y1="9" y2="15" />
              <line x1="9" x2="15" y1="9" y2="15" />
            </svg>
          </div>
        </div>
        <h2 className="text-2xl font-semibold">Meeting not found</h2>
        <p className="text-neutral-500 text-sm max-w-xs mx-auto">
          No active meeting with code <span className="font-mono text-neutral-300 bg-white/[0.04] px-2 py-0.5 rounded-lg">{code}</span>
        </p>
        <button
          onClick={() => router.push("/")}
          className="mt-2 py-2.5 px-8 rounded-2xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] text-white font-medium transition-all duration-200 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
        >
          Back to Home
        </button>
      </CenteredScreen>
    );
  }

  if (roomState === "error") {
    return (
      <CenteredScreen>
        <div className="w-20 h-20 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" x2="12" y1="9" y2="13" />
            <line x1="12" x2="12.01" y1="17" y2="17" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold">Something went wrong</h2>
        <p className="text-neutral-500 text-sm max-w-xs mx-auto">{errorMsg}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-2 py-2.5 px-8 rounded-2xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] text-white font-medium transition-all duration-200 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
        >
          Back to Home
        </button>
      </CenteredScreen>
    );
  }

  if (roomState === "connecting" && !isHost) {
    return (
      <CenteredScreen>
        <div className="relative w-16 h-16 mx-auto mb-2">
          <div className="absolute inset-0 rounded-full border-[3px] border-neutral-800" />
          <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-blue-500 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
              <rect x="2" y="6" width="14" height="12" rx="2" />
            </svg>
          </div>
        </div>
        <p className="text-neutral-400 font-medium">{status}</p>
        <p className="text-neutral-600 text-sm font-mono tracking-widest">{code}</p>
      </CenteredScreen>
    );
  }

  const totalTiles = 1 + remotePeers.size;
  let gridClass = "grid-cols-1 max-w-2xl mx-auto";
  if (totalTiles === 2) gridClass = "grid-cols-1 sm:grid-cols-2";
  else if (totalTiles >= 3 && totalTiles <= 4) gridClass = "grid-cols-2";
  else if (totalTiles >= 5) gridClass = "grid-cols-2 lg:grid-cols-3";

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#09090b]">
      {/* Status bar */}
      {status && (
        <div className="text-center py-2 text-xs text-neutral-500 tracking-wide">
          <span className="inline-flex items-center gap-2">
            {status === "Waiting for others to join..." && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
            {status}
          </span>
        </div>
      )}

      {/* Video grid */}
      <div className={`flex-1 grid ${gridClass} gap-2.5 p-2.5 auto-rows-fr`}>
        <VideoTile isLocal>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover scale-x-[-1]"
          />
          <TileLabel text={isHost ? "You (Host)" : "You"} />
        </VideoTile>

        {Array.from(remotePeers.values()).map((rp) => (
          <RemoteVideoTile key={rp.peerId} peer={rp} />
        ))}
      </div>

      {/* Controls bar */}
      <div className="glass-strong flex items-center justify-center gap-2 sm:gap-3 px-4 py-3">
        <ControlButton
          onClick={toggleMic}
          active={micOn}
          label={micOn ? "Mute" : "Unmute"}
          icon={micOn ? <MicIcon /> : <MicOffIcon />}
        />
        <ControlButton
          onClick={toggleCam}
          active={camOn}
          label={camOn ? "Stop Video" : "Start Video"}
          icon={camOn ? <CamIcon /> : <CamOffIcon />}
        />
        <ControlButton
          onClick={copyCode}
          active={true}
          label={copied ? "Copied!" : code}
          icon={<CopyIcon />}
        />
        <div className="w-px h-8 bg-white/[0.06] mx-1" />
        <ControlButton
          onClick={leave}
          active={false}
          danger
          label="Leave"
          icon={<LeaveIcon />}
        />
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 glass-strong text-white text-sm px-5 py-3 rounded-2xl shadow-2xl animate-fade-in-up flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          {toast}
        </div>
      )}
    </div>
  );
}

function CenteredScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center h-screen">
      <div className="text-center space-y-3 animate-float" style={{ animationDuration: "4s" }}>
        {children}
      </div>
    </div>
  );
}

function VideoTile({ children, isLocal }: { children: React.ReactNode; isLocal?: boolean }) {
  return (
    <div className={`relative rounded-2xl overflow-hidden bg-neutral-900 ring-1 ring-white/[0.06] ${isLocal ? "shadow-lg shadow-blue-500/5" : ""}`}>
      {children}
    </div>
  );
}

function TileLabel({ text }: { text: string }) {
  return (
    <span className="absolute bottom-2.5 left-3 text-xs font-medium bg-black/50 backdrop-blur-sm px-2.5 py-1 rounded-full text-white/80">
      {text}
    </span>
  );
}

function RemoteVideoTile({ peer }: { peer: RemotePeer }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current && peer.stream) {
      ref.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <VideoTile>
      {peer.stream ? (
        <video ref={ref} autoPlay playsInline className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <span className="text-neutral-600 text-xs">Connecting...</span>
        </div>
      )}
      <TileLabel text={peer.peerId.length > 10 ? `${peer.peerId.slice(0, 8)}...` : peer.peerId} />
    </VideoTile>
  );
}

function ControlButton({
  onClick,
  active,
  danger,
  label,
  icon,
}: {
  onClick: () => void;
  active: boolean;
  danger?: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-1 cursor-pointer`}
      title={label}
    >
      <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
        danger
          ? "bg-red-500/15 text-red-400 hover:bg-red-500 hover:text-white hover:scale-105"
          : active
            ? "bg-white/[0.08] text-white hover:bg-white/[0.14] hover:scale-105"
            : "bg-white/[0.04] text-neutral-500 hover:bg-white/[0.08] hover:text-neutral-300 hover:scale-105"
      } active:scale-95`}>
        {icon}
      </div>
      <span className={`text-[10px] font-medium tracking-wide transition-colors ${
        danger ? "text-red-400/70" : "text-neutral-600"
      }`}>
        {label}
      </span>
    </button>
  );
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <path d="M5 10v2a7 7 0 0 0 12 5.29" />
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

function CamOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196" />
      <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 2.59 3.4Z" />
      <line x1="22" x2="16" y1="2" y2="8" />
      <line x1="16" x2="22" y1="2" y2="8" />
    </svg>
  );
}
