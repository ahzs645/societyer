import { Link, useLocation } from "react-router-dom";
import { SearchX } from "lucide-react";
import { PageHeader } from "./_helpers";
import { EmptyState } from "../components/ui";

/**
 * Unknown address. Inside the workspace it renders in the app shell (so the
 * sidebar is still there to go somewhere else); anywhere else it is a small
 * standalone page. Either way it says the page doesn't exist instead of
 * silently landing on the dashboard.
 */
export function NotFoundPage({ standalone = false }: { standalone?: boolean }) {
  const { pathname } = useLocation();
  const body = (
    <div role="status" data-testid="page-not-found">
      <EmptyState
        icon={<SearchX size={20} />}
        title="This page doesn't exist"
        description={
          <>
            Nothing lives at <code>{pathname}</code>. The link may be mistyped or out of date.
          </>
        }
        action={<Link className="btn btn--accent" to={standalone ? "/" : "/app"}>Go to the dashboard</Link>}
      />
    </div>
  );
  if (standalone) {
    return (
      <main className="not-found-standalone">
        <h1 className="not-found-standalone__title">Page not found</h1>
        {body}
      </main>
    );
  }
  return (
    <div className="page">
      <PageHeader title="Page not found" routeKey="/not-found" icon={<SearchX size={16} />} iconColor="gray" />
      {body}
    </div>
  );
}

export default NotFoundPage;
