import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/currentUser";
import { lookupUserCode, normalizeUserCode } from "@/lib/auth/deviceLink";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { fmt, getDictionary } from "@/lib/i18n/getDictionary";
import { buttonClass, Card, Eyebrow } from "@/components/ui";
import { ApproveForm } from "@/components/link/ApproveForm";

export async function generateMetadata({ params }: PageProps<"/[locale]/link">): Promise<Metadata> {
  return { title: getDictionary((await params).locale).link.title };
}

export default async function LinkPage({ params, searchParams }: PageProps<"/[locale]/link">) {
  const { locale: l } = await params;
  const locale = isLocale(l) ? l : defaultLocale;
  const raw = (await searchParams).code;
  const rawCode = typeof raw === "string" ? raw : "";
  const user = await requireUser(locale, `/${locale}/link${rawCode ? `?code=${encodeURIComponent(rawCode)}` : ""}`);
  const t = getDictionary(locale).link;
  const code = normalizeUserCode(rawCode);
  const link = await lookupUserCode(code, user.id);

  return (
    <div className="flex flex-1 items-start justify-center bg-canvas-2 px-4 py-12 sm:py-16">
      <Card className="w-full max-w-lg">
        <Eyebrow>{t.eyebrow}</Eyebrow>
        <h1 className="mt-2 text-3xl uppercase leading-tight sm:text-4xl">{t.title}</h1>

        {link.state === "pending" && code && (
          <div className="mt-4 flex flex-col gap-6">
            <p className="text-text-muted">{t.lead}</p>
            <div className="on-dark bg-surface px-4 py-6 text-center text-text-on-dark">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-on-dark-muted">{t.codeLabel}</p>
              <p className="mt-2 font-mono text-4xl font-bold tracking-[0.15em] sm:text-5xl" aria-label={code.split("").join(" ")}>
                {code}
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="font-bold">{t.client}</dt>
              <dd>
                {link.client ?? t.unknownClient}
                {link.clientVersion ? ` ${link.clientVersion}` : ""}
              </dd>
            </dl>
            <p>{fmt(t.signedInAs, { name: user.display_name })}</p>
            <ApproveForm code={code} t={t} />
          </div>
        )}

        {link.state === "approved" && (
          <div className="mt-4 flex flex-col gap-2 border-2 border-success-ink bg-[#f0fdf4] p-4" role="status">
            <p className="font-display text-xl uppercase text-success-ink">{link.mine ? t.successTitle : t.invalidTitle}</p>
            <p className="font-semibold">{link.mine ? t.successBody : t.otherAccount}</p>
          </div>
        )}

        {link.state === "expired" && (
          <div className="mt-4 flex flex-col gap-2 border-2 border-warning-ink bg-[#fffbeb] p-4" role="status">
            <p className="font-display text-xl uppercase text-warning-ink">{t.expiredTitle}</p>
            <p className="font-semibold">{t.expiredBody}</p>
          </div>
        )}

        {link.state === "invalid" && (
          <div className="mt-4 flex flex-col gap-4">
            {rawCode ? (
              <div className="border-2 border-danger-ink bg-[#fef2f2] p-4" role="alert">
                <p className="font-display text-xl uppercase text-danger-ink">{t.invalidTitle}</p>
                <p className="font-semibold">{t.invalidBody}</p>
              </div>
            ) : (
              <p className="text-text-muted">{t.enterTitle}</p>
            )}
            <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-2">
                <label htmlFor="code" className="font-bold">
                  {t.codeLabel}
                </label>
                <input
                  id="code"
                  name="code"
                  defaultValue={rawCode}
                  autoComplete="off"
                  autoCapitalize="characters"
                  placeholder="ABCD-EFGH"
                  className="min-h-12 border-2 border-surface px-3 font-mono text-xl uppercase tracking-widest"
                />
              </div>
              <button type="submit" className={buttonClass("dark")}>
                {t.check}
              </button>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}
