export function printCurrentPage() {
  if (typeof window === "undefined") {
    return;
  }

  window.print();
}
