import { notFound } from "next/navigation";

/** Unknown paths under a language: render the localized not-found page inside the site layout. */
export default function UnknownPage() {
  notFound();
}
