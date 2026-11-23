import {
  Landmark, Building2, SprayCan, Wrench, Zap, Flame, Droplet, Recycle, Wifi, Smartphone, GraduationCap, Medal, Baby, Sun, Shirt,
  Stethoscope, ShoppingCart, UtensilsCrossed, Car, Fuel, HeartPulse, Scissors, ShoppingBag, Ticket, Plane, Gift, Dumbbell,
  Tv, Music, Repeat, Scale, CircleHelp, ArrowLeftRight, Briefcase, Award, Wallet, Sparkles, Users, Receipt, PiggyBank,
  Banknote, CreditCard, House, Bike, Bus, TrainFront, Pill, PawPrint, Book, Gamepad2, Coffee, Pizza, Wine, Hammer, Sofa,
  Lightbulb, Palette, Camera, Laptop, Shield, FileText, Hotel, Popcorn, Apple, School, Volleyball, Gavel, Handshake, Coins,
  Glasses, Dog, Cat, Flower2, Bath, Bed, Plug, Hospital, Syringe, Package, Truck, SquareParking, HandCoins, Calculator,
  type LucideIcon
} from 'lucide-react';

/** Icone selezionabili per categorie e conti (nome → componente). */
export const ICONS: Record<string, LucideIcon> = {
  Landmark, House, Building2, Sofa, Bed, Bath, SprayCan, Wrench, Hammer, Plug, Lightbulb,
  Zap, Flame, Droplet, Recycle, Wifi, Smartphone, Laptop,
  GraduationCap, School, Book, Medal, Volleyball, Baby, Sun, Shirt, Glasses, Stethoscope, Hospital, Pill, Syringe,
  ShoppingCart, Apple, UtensilsCrossed, Pizza, Coffee, Wine,
  Car, Fuel, SquareParking, Bike, Bus, TrainFront, Plane, Hotel, Truck, Package,
  HeartPulse, Scissors, ShoppingBag, Ticket, Popcorn, Gamepad2, Camera, Palette, Gift, Dumbbell, Flower2, PawPrint, Dog, Cat,
  Tv, Music, Repeat, Scale, Gavel, Handshake, Shield, FileText, Calculator,
  Briefcase, Award, Wallet, Sparkles, Users, Receipt, PiggyBank, Banknote, CreditCard, Coins, HandCoins,
  ArrowLeftRight, CircleHelp
};

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const C = ICONS[name] ?? CircleHelp;
  return <C size={size} className={className} strokeWidth={2} aria-hidden />;
}

/** Bollino colorato con icona (categoria). */
export function Badge({ icon, color, size = 40 }: { icon: string; color: string; size?: number }) {
  return (
    <span className="badge" style={{ ['--c' as any]: color, width: size, height: size }}>
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}
