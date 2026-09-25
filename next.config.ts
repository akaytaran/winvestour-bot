import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false, // Tur 34 K3: `next dev` depo köküne AGENTS.md/CLAUDE.md yazmasın (git status ölçümünü kirletiyordu)
};

export default nextConfig;
