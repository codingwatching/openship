"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useProjectSettings } from "@/context/ProjectSettingsContext";
import { usePlatform } from "@/context/PlatformContext";
import { serviceKind, servicesApi, type Service, type ServiceContainer, type ServiceInput } from "@/lib/api/services";
import { deployApi } from "@/lib/api/deploy";
import { useToast } from "@/context/ToastContext";
import { resolveServiceHostnameLabel } from "@repo/core";
import { useRouter } from "next/navigation";
import {
  Layers,
  RefreshCw,
  Globe,
  Container,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  Plus,
} from "lucide-react";
import { ServiceDetailPanel } from "./services/ServiceDetailPanel";
import { AddServiceModal } from "./services/AddServiceModal";

/* ── Main Component ─────────────────────────────────────────────────── */

export const ServicesTab = () => {
  const { id, slug, projectData, servicesData, refreshServices } = useProjectSettings();
  const { baseDomain } = usePlatform();
  const { showToast } = useToast();
  const router = useRouter();

  const [containers, setContainers] = useState<ServiceContainer[]>([]);
  const [containersLoading, setContainersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const services = servicesData.services;
  const loading = servicesData.isLoading || containersLoading;
  const projectSlugBase = projectData.slug || projectData.name || "project";
  const selectedId = slug?.[1] ?? null;
  const hasProjectId = Boolean(id && id !== "undefined");

  const fetchData = useCallback(async () => {
    if (!hasProjectId) {
      setContainers([]);
      setContainersLoading(false);
      return;
    }

    try {
      setContainersLoading(true);
      setError(null);
      const [, ctRes] = await Promise.all([refreshServices(), servicesApi.containers(id)]);
      if (ctRes.success) setContainers(ctRes.containers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load services");
    } finally {
      setContainersLoading(false);
    }
  }, [hasProjectId, id, refreshServices]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const containerFor = (serviceId: string) => containers.find((c) => c.serviceId === serviceId);

  const selectedService = services.find((s) => s.id === selectedId);

  const resolveServiceUrl = (service: Service) => {
    if (!service.exposed) return null;
    if (service.domainType === "custom" && service.customDomain) {
      return `https://${service.customDomain}`;
    }
    const subdomain = resolveServiceHostnameLabel(
      projectSlugBase,
      service.name,
      service.domain,
      serviceKind(service),
    );
    return `https://${subdomain}.${baseDomain}`;
  };

  const openService = (serviceId: string) => {
    if (!hasProjectId) return;
    router.push(`/projects/${id}/services/${serviceId}`);
  };

  const closeService = () => {
    if (!hasProjectId) return;
    router.push(`/projects/${id}/services`);
  };

  const handleCreateService = async (data: ServiceInput) => {
    if (!hasProjectId) return;

    const result = await servicesApi.create(id, data);
    if (!result.success) {
      throw new Error("Failed to create service");
    }

    await fetchData();

    // Auto-deploy the new service. Without this step `createService` only
    // saves a DB row - no container actually starts until the next project
    // deploy. We trigger a redeploy of the project's active deployment so
    // the user's "Add" gesture really brings the service up.
    //
    // If there's no active deployment (brand new project), we surface a
    // softer message - the user has to do the first deploy themselves.
    const activeDeploymentId = projectData?.activeDeploymentId;
    if (activeDeploymentId) {
      showToast(`${data.name} added - deploying…`, "success", "Service");
      deployApi
        .buildRedeploy(activeDeploymentId)
        .then((res: any) => {
          if (res?.success === false) {
            showToast(res?.error || "Deploy failed", "error", data.name);
            return;
          }
          showToast(`${data.name} is starting`, "success", "Service");
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "Deploy failed";
          showToast(msg, "error", data.name);
        });
    } else {
      showToast(`${data.name} saved - deploy the project to start it`, "success", "Service");
    }

    if (result.service?.id) {
      router.push(`/projects/${id}/services/${result.service.id}`);
    }
  };

  /* ── Loading state ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-card rounded-2xl border border-border/50 p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-muted rounded-lg" />
                <div className="h-3 w-48 bg-muted/60 rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* ── Error state ───────────────────────────────────────────────── */
  if (error || servicesData.error) {
    return (
      <div className="bg-card rounded-2xl border border-border/50 p-8 text-center">
        <AlertCircle className="size-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground mb-1">Failed to load services</p>
        <p className="text-xs text-muted-foreground mb-4">{error || servicesData.error}</p>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] transition-colors"
        >
          <RefreshCw className="size-3.5" />
          Retry
        </button>
      </div>
    );
  }

  /* ── Empty state ───────────────────────────────────────────────── */
  if (services.length === 0) {
    return (
      <>
        <div className="bg-card rounded-2xl border border-border/50 px-6 pb-10 text-center">
          {/* SVG illustration - central app card linked to three service
              nodes (database, cache, queue). Uses the same `th-*` token
              palette as the deployments empty state so the visual language
              stays consistent across the app. */}
          <div className="relative mx-auto w-72 h-44">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 288 180" fill="none">
              {/* Decorative dots scattered behind */}
              <circle cx="22" cy="46" r="4" fill="var(--th-on-10)" />
              <circle cx="42" cy="138" r="6" fill="var(--th-on-08)" />
              <circle cx="262" cy="38" r="3" fill="var(--th-on-12)" />
              <circle cx="270" cy="128" r="5" fill="var(--th-on-06)" />
              <path d="M16 110l2-4 2 4-4-2 4 0-4 2z" fill="var(--th-on-16)" />
              <path d="M256 154l1.5-3 1.5 3-3-1.5 3 0-3 1.5z" fill="var(--th-on-12)" />

              {/* Dashed connector lines from app card to each service */}
              <path
                d="M144 78 Q 90 70 60 76"
                stroke="var(--th-on-12)"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                fill="none"
              />
              <path
                d="M144 92 Q 144 130 144 138"
                stroke="var(--th-on-12)"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                fill="none"
              />
              <path
                d="M156 78 Q 200 70 228 76"
                stroke="var(--th-on-12)"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                fill="none"
              />

              {/* Central "app" card */}
              <rect
                x="112"
                y="56"
                width="64"
                height="48"
                rx="10"
                fill="var(--th-card-bg)"
                stroke="var(--th-bd-default)"
                strokeWidth="1"
              />
              <rect x="112" y="56" width="64" height="14" rx="10" fill="var(--th-sf-05)" />
              <circle cx="122" cy="63" r="2" fill="#ef4444" fillOpacity="0.6" />
              <circle cx="130" cy="63" r="2" fill="#eab308" fillOpacity="0.6" />
              <circle cx="138" cy="63" r="2" fill="#22c55e" fillOpacity="0.6" />
              <rect x="120" y="78" width="32" height="3" rx="1.5" fill="var(--th-on-12)" />
              <rect x="120" y="85" width="48" height="2.5" rx="1.25" fill="var(--th-on-08)" />
              <rect x="120" y="91" width="40" height="2.5" rx="1.25" fill="var(--th-on-08)" />

              {/* Service node: Database (left) - stacked cylinders */}
              <g transform="translate(34, 50)">
                <ellipse cx="26" cy="6" rx="20" ry="5" fill="var(--th-sf-04)" stroke="var(--th-bd-subtle)" strokeWidth="1" />
                <path d="M6 6 L6 22 Q 6 27 26 27 Q 46 27 46 22 L 46 6" fill="var(--th-sf-03)" stroke="var(--th-bd-subtle)" strokeWidth="1" />
                <ellipse cx="26" cy="6" rx="20" ry="5" fill="var(--th-card-bg)" stroke="var(--th-bd-default)" strokeWidth="1" />
                <ellipse cx="26" cy="22" rx="20" ry="5" fill="var(--th-card-bg)" stroke="var(--th-bd-default)" strokeWidth="1" />
                <line x1="6" y1="6" x2="6" y2="22" stroke="var(--th-bd-default)" strokeWidth="1" />
                <line x1="46" y1="6" x2="46" y2="22" stroke="var(--th-bd-default)" strokeWidth="1" />
              </g>

              {/* Service node: Cache (bottom) - lightning bolt in chip */}
              <g transform="translate(124, 124)">
                <rect width="40" height="32" rx="8" fill="var(--th-card-bg)" stroke="var(--th-bd-default)" strokeWidth="1" />
                <path
                  d="M22 8 L 14 18 L 19 18 L 17 24 L 25 14 L 20 14 L 22 8 Z"
                  fill="var(--th-on-30)"
                  stroke="var(--th-on-40)"
                  strokeWidth="0.5"
                />
              </g>

              {/* Service node: Queue/Container (right) - stacked rounded rects */}
              <g transform="translate(202, 50)">
                <rect x="6" y="14" width="40" height="18" rx="4" fill="var(--th-sf-04)" stroke="var(--th-bd-subtle)" strokeWidth="1" />
                <rect x="3" y="7" width="40" height="18" rx="4" fill="var(--th-sf-03)" stroke="var(--th-bd-subtle)" strokeWidth="1" />
                <rect x="0" y="0" width="40" height="18" rx="4" fill="var(--th-card-bg)" stroke="var(--th-bd-default)" strokeWidth="1" />
                <circle cx="6" cy="9" r="1.5" fill="var(--th-on-30)" />
                <rect x="12" y="7.5" width="22" height="3" rx="1.5" fill="var(--th-on-12)" />
                <rect x="12" y="12.5" width="14" height="2.5" rx="1.25" fill="var(--th-on-08)" />
              </g>
            </svg>
          </div>

          <h3 className="text-lg font-medium text-foreground/80 mb-2">
            No services connected
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-8 leading-relaxed">
            Add a database, cache, or any other service to extend your app.
            Pick from the catalog or paste any Docker image.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5"
            >
              <Plus className="size-4" />
              Add Service
            </button>
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 px-6 py-3 bg-muted/50 text-foreground text-sm font-medium rounded-xl hover:bg-muted transition-colors"
            >
              <RefreshCw className="size-4" />
              Refresh
            </button>
          </div>
        </div>
        <AddServiceModal
          open={createOpen}
          projectName={projectSlugBase}
          isCloudProject={projectData?.deployTarget === "cloud"}
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreateService}
        />
      </>
    );
  }

  /* ── Service list + detail panel ───────────────────────────────── */
  if (selectedService) {
    return (
      <div className="space-y-5">
        <div className="bg-card rounded-2xl border border-border/50 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={closeService}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-medium bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] transition-colors shrink-0"
              >
                <ArrowLeft className="size-3.5" />
                All services
              </button>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground truncate">
                  {selectedService.name}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  Service settings, ports, logs, and container controls.
                </p>
              </div>
            </div>

            <button
              onClick={fetchData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] transition-colors shrink-0"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </button>
          </div>
        </div>

        <ServiceDetailPanel
          service={selectedService}
          container={containerFor(selectedService.id)}
          projectId={id}
          projectSlugBase={projectSlugBase}
          onRefresh={fetchData}
          onDeleted={closeService}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-card rounded-2xl border border-border/50 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Layers className="size-[18px] text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {services.length} Service{services.length !== 1 ? "s" : ""}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Choose a service to open its full settings screen.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1] transition-colors"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-3.5" />
              Add Service
            </button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 divide-y divide-border/30 overflow-hidden">
        {services.map((svc) => {
          const ct = containerFor(svc.id);
          const status = ct?.status ?? (svc.enabled ? "stopped" : "disabled");
          const resolvedUrl = resolveServiceUrl(svc);
          const isMonorepo = serviceKind(svc) === "monorepo";

          // Monorepo sub-app subtitle assembled from the metadata each
          // row already carries: rootDirectory (apps/dashboard) · framework
          // (Next.js) · port (3202) → resolved URL (example.opsh.io).
          // Each segment is shown only if present - keeps the line short
          // for sub-apps that haven't been fully filled in yet.
          const monorepoBits: string[] = [];
          if (svc.rootDirectory) monorepoBits.push(svc.rootDirectory);
          if (svc.framework) monorepoBits.push(svc.framework);
          if (svc.exposedPort) monorepoBits.push(`port ${svc.exposedPort}`);
          const subtitle = isMonorepo
            ? monorepoBits.join(" · ")
            : svc.image || svc.build || "";
          const urlHost = resolvedUrl?.replace("https://", "");

          return (
            <button
              key={svc.id}
              onClick={() => openService(svc.id)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-foreground/[0.025]"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-muted/50">
                <Container className="size-[18px] text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-foreground truncate">
                    {svc.name}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] ${svc.exposed ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted/60 text-muted-foreground/70"}`}
                  >
                    <Globe className="size-2.5" />
                    {svc.exposed ? "Public" : "Internal"}
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground truncate mt-1">
                  {isMonorepo ? (
                    // Monorepo: "apps/dashboard · Next.js · port 3202 → my-app.opsh.io"
                    <>
                      {subtitle}
                      {urlHost && (
                        <>
                          {subtitle && " → "}
                          <span className="text-foreground/80">{urlHost}</span>
                        </>
                      )}
                      {!subtitle && !urlHost && "-"}
                    </>
                  ) : (
                    // Compose: existing single-line behavior - URL or
                    // image/build descriptor as fallback.
                    urlHost ?? subtitle ?? "-"
                  )}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <StatusBadge status={status} />
                <ChevronRight className="size-4 text-muted-foreground/50" />
              </div>
            </button>
          );
        })}
      </div>

      <AddServiceModal
        open={createOpen}
        projectName={projectSlugBase}
        isCloudProject={projectData?.deployTarget === "cloud"}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateService}
      />
    </div>
  );
};

/* ── Status Badge ───────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { dot: string; badge: string; label: string }> = {
    running: {
      dot: "bg-emerald-500",
      badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      label: "Running",
    },
    stopped: {
      dot: "bg-muted-foreground/30",
      badge: "bg-muted/60 text-muted-foreground/70",
      label: "Stopped",
    },
    disabled: {
      dot: "bg-muted-foreground/20",
      badge: "bg-muted/40 text-muted-foreground/50",
      label: "Disabled",
    },
    failed: {
      dot: "bg-red-500",
      badge: "bg-red-500/10 text-red-600 dark:text-red-400",
      label: "Failed",
    },
    starting: {
      dot: "bg-amber-500",
      badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      label: "Starting",
    },
  };
  const s = map[status] ?? map.stopped;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.badge}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
