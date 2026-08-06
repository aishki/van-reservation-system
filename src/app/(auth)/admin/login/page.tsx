import { LoginForm } from "@/components/auth/login-form";
import { LoginHero } from "@/components/auth/login-hero";
import { LoginPanelCopy } from "@/components/auth/login-panel-copy";

export default function AdminLoginPage() {
  return (
    <main className="relative flex min-h-screen items-center overflow-hidden bg-white">
      {/* Faint route-map texture behind the form, fading out toward the panel. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-[url('/assets/map-bg.png')] bg-cover bg-center opacity-20 [mask-image:linear-gradient(200deg,#000,transparent_58%)]"
      />
      <LoginHero variant="admin" />
      <LoginPanelCopy variant="admin" />
      <div className="relative z-30 flex w-full justify-center px-6 py-12 lg:justify-start lg:px-[7vw] lg:py-0">
        <LoginForm variant="admin" />
      </div>
    </main>
  );
}
