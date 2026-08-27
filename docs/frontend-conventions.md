# Frontend Conventions

## Styling

### Tailwind CSS 4

Uses Tailwind CSS 4 (CSS-based, no config file). Theme customization via `@theme` in `app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-brand: #fca200;
  --color-brand-hover: #e69200;
  --color-success: #22c55e;
}
```

Custom colors become utilities: `bg-brand`, `text-brand-hover`, etc.

### CSS Variables

Design tokens live in `app/globals.css` using CSS variables. Reference them with `var()`:

```tsx
className="bg-[var(--bg-elevated)] text-[var(--text-primary)]"
```

Common variable patterns: `--bg-base`, `--bg-elevated`, `--bg-hover`, `--bg-active`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-default`, `--border-interactive`.

### Class Utilities

Use `cn()` from `@/utils/cn` to merge classes conditionally:

```tsx
import { cn } from "@/utils/cn";

className={cn(
  "rounded-lg px-4 py-2",
  isActive && "bg-[var(--accent-color)]",
  className
)}
```

### Animations

Custom animations defined in `globals.css` (`animate-fade-in`, `animate-shake`, `animate-shimmer`, etc.). TV tile grid uses `--tile-index` for stagger effects.

## Components

### Structure

```
components/
  ui/           # Reusable primitives (Button, Card, Modal, etc.)
  player/       # Player UI components
  cards/        # Card-specific components
  layout/       # Layout components
  activity/     # Activity panel
  lyrics/       # Lyrics components
```

### Patterns

- Client components require `"use client"` directive
- Use `memo()` for expensive components with custom comparison when needed
- Props extend HTML attributes via `ButtonHTMLAttributes<HTMLButtonElement>`
- Export `displayName` for debugging
- TV navigation uses `data-tv-card` and `data-tv-card-index` attributes

```tsx
"use client";

import { forwardRef, memo } from "react";
import { cn } from "@/utils/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "ai" | "icon";
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", isLoading, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn("rounded px-4 py-2", variantStyles[variant], className)}
        disabled={isLoading}
        {...props}
      >
        {isLoading ? <Spinner /> : children}
      </button>
    );
  }
);
Button.displayName = "Button";
```

## Hooks

### Location

- Global hooks: `/hooks/`
- Feature-specific hooks: `/features/[feature]/hooks/`

### Patterns

Return typed objects with derived values computed within the hook. Keep hooks focused.

```tsx
export interface UseProgressReturn {
  duration: number;
  displayTime: number;
  progress: number;
}

export function usePlaybackProgress(): UseProgressReturn {
  const { duration, displayTime } = useAudioState();
  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;
  return { duration, displayTime, progress };
}
```

## React Query

Custom query hooks in `/hooks/useQueries.ts` with exported query keys. Pattern: `use[Entity]Query`, `use[Entity]Mutation`.

```tsx
export const queryKeys = {
  artists: () => ["artists"] as const,
  artist: (id: string) => ["artist", id] as const,
};

// Usage
const { data } = useQuery({ queryKey: queryKeys.artists(), queryFn: fetchArtists });
```

## Feature Organization

Features live under `/features/` with their own components, hooks, and types:

```
features/
  home/
    components/
    hooks/
    types.ts
  library/
  search/
  ...
```

## State Management

- React Context for global UI state (audio playback, auth, toast notifications)
- React Query for server state
- Local component state with `useState`/`useReducer`
- No Redux

## Libraries

| Library | Use |
|---------|-----|
| `lucide-react` | Icons |
| `framer-motion` | Animations |
| `next/image` | Images (use `CachedImage` wrapper) |
| `@tanstack/react-query` | Server state |
| `@tanstack/react-virtual` | Virtual lists |
| `date-fns` | Date formatting |
| `three`, `@react-three/fiber`, `deck.gl` | 3D/visualization |

## TypeScript

- Strict mode enabled
- Use `import type` for type-only imports
- Props interfaces named `[Component]Props`
- Feature types in `features/[feature]/types.ts`