import "@solana/wallet-adapter-react-ui/styles.css";
import { SolanaProviders } from "@/components/solana-providers";

export default function ProtectedSolanaLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <SolanaProviders>{children}</SolanaProviders>;
}
