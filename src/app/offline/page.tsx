export default function OfflinePage() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-4">
      <h1 className="text-foreground text-2xl font-bold">You are offline</h1>
      <p className="text-muted-foreground mt-2">
        Please check your internet connection and try again.
      </p>
    </div>
  );
}
