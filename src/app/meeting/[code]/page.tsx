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

  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeer>>(new Map());
  const [status, setStatus] = useState<string>("Initializing...");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [copied, setCopied] = useState(false);

  const rosterRef = useRef<Set<string>>(new Set());

  const syncState = useCallback(() => {
    setRemotePeers(new Map(remotePeersRef.current));
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
  }, [syncState, broadcastRoster]);

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
        setStatus("Camera/mic access denied");
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
          setStatus("Waiting for others to join...");
        } else {
          setStatus("Connecting to host...");
          callPeer(code);
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

  function copyCode() {
    navigator.clipboard.writeText(code);
    setCopied(true);
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

  const totalTiles = 1 + remotePeers.size;
  let gridClass = "grid-cols-1";
  if (totalTiles === 2) gridClass = "grid-cols-1 sm:grid-cols-2";
  else if (totalTiles >= 3 && totalTiles <= 4) gridClass = "grid-cols-2";
  else if (totalTiles >= 5) gridClass = "grid-cols-2 sm:grid-cols-3";

  return (
    <div className="flex-1 flex flex-col h-screen">
      {status && (
        <div className="text-center py-2 text-sm text-neutral-400 bg-neutral-900">
          {status}
        </div>
      )}

      <div className={`flex-1 grid ${gridClass} gap-3 p-3 auto-rows-fr`}>
        <div className="relative bg-neutral-800 rounded-2xl overflow-hidden">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-2 left-3 text-xs bg-black/60 px-2 py-1 rounded-lg">
            You {isHost ? "(Host)" : ""}
          </span>
        </div>

        {Array.from(remotePeers.values()).map((rp) => (
          <RemoteVideo key={rp.peerId} peer={rp} />
        ))}
      </div>

      <div className="flex items-center justify-center gap-3 p-4 bg-neutral-900/80 backdrop-blur">
        <ControlButton onClick={toggleMic} active={micOn} label={micOn ? "Mic On" : "Mic Off"}>
          {micOn ? <MicIcon /> : <MicOffIcon />}
        </ControlButton>
        <ControlButton onClick={toggleCam} active={camOn} label={camOn ? "Cam On" : "Cam Off"}>
          {camOn ? <CamIcon /> : <CamOffIcon />}
        </ControlButton>
        <ControlButton onClick={copyCode} active={true} label={copied ? "Copied!" : "Copy Code"}>
          <CopyIcon />
        </ControlButton>
        <ControlButton onClick={leave} active={false} danger label="Leave">
          <LeaveIcon />
        </ControlButton>
      </div>
    </div>
  );
}

function RemoteVideo({ peer }: { peer: RemotePeer }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current && peer.stream) {
      ref.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className="relative bg-neutral-800 rounded-2xl overflow-hidden">
      {peer.stream ? (
        <video ref={ref} autoPlay playsInline className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-neutral-500">
          Connecting...
        </div>
      )}
      <span className="absolute bottom-2 left-3 text-xs bg-black/60 px-2 py-1 rounded-lg">
        {peer.peerId.slice(0, 12)}
      </span>
    </div>
  );
}

function ControlButton({
  onClick,
  active,
  danger,
  label,
  children,
}: {
  onClick: () => void;
  active: boolean;
  danger?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const bg = danger
    ? "bg-red-600 hover:bg-red-500"
    : active
      ? "bg-neutral-700 hover:bg-neutral-600"
      : "bg-neutral-700/60 hover:bg-neutral-600";

  return (
    <button
      onClick={onClick}
      title={label}
      className={`${bg} w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer`}
    >
      {children}
    </button>
  );
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

function CamOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196" />
      <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" />
      <line x1="12" x2="12" y1="2" y2="12" />
    </svg>
  );
}
