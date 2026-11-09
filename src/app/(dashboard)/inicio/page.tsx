"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";

// Porta de entrada depois do login: lojas com o Pátio ligado abrem em Hoje;
// as demais, no painel do CRM.
export default function Inicio() {
  const { branding, profileLoading: loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(branding?.modules?.estoque ? "/hoje" : "/dashboard");
  }, [branding, loading, router]);
  return null;
}
