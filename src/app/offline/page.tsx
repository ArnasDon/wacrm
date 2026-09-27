export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <h1 className="text-2xl font-bold text-foreground">You are offline</h1>
      <p className="mt-2 text-muted-foreground">
        Please check your internet connection and try again.
      </p>
    </div>
  );
}
