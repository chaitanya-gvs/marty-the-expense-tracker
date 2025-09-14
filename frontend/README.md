# Expense Tracker Frontend

A modern React/Next.js frontend for the Expense Tracker application, built with TypeScript, Tailwind CSS, and shadcn/ui components.

## Features

### MVP Features (Phase 1)
- **Transactions Management**: Virtualized table with filtering, sorting, and inline editing
- **Split Editor**: Equal and custom split modes for shared expenses
- **Budget Tracking**: Monthly budgets with progress tracking and charts
- **Review Queue**: Approve/reject uncertain transactions
- **Settings**: Manage categories, tags, and preferences

### Planned Features (Phase 2)
- Smart rules and autocomplete
- Transfer and refund linking suggestions
- Splitwise integration
- Advanced reports and analytics
- Notifications and alerts

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui + Radix UI
- **State Management**: React Query (TanStack Query)
- **Tables**: TanStack Table with virtualization
- **Charts**: Recharts
- **Forms**: React Hook Form + Zod validation
- **Icons**: Lucide React

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.local.example .env.local
# Edit .env.local with your configuration
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── transactions/       # Transactions page
│   ├── budgets/           # Budgets page
│   ├── review/            # Review queue page
│   └── settings/          # Settings page
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── layout/           # Layout components
│   ├── transactions/     # Transaction-related components
│   ├── budgets/          # Budget-related components
│   ├── split-editor/     # Split editor component
│   ├── review/           # Review queue components
│   └── settings/         # Settings components
├── hooks/                # Custom React hooks
├── lib/                  # Utility libraries
│   ├── api/             # API client
│   └── types/           # TypeScript type definitions
└── store/               # State management (if needed)
```

## API Integration

The frontend communicates with the backend API through:
- **API Client**: Centralized HTTP client in `src/lib/api/client.ts`
- **React Query Hooks**: Custom hooks for data fetching and mutations
- **Type Safety**: Full TypeScript integration with backend schemas

### Available Hooks
- `useTransactions()` - Fetch and manage transactions
- `useBudgets()` - Manage budgets
- `useCategories()` - Manage categories
- `useTags()` - Manage tags

## Key Components

### Transactions Table
- Virtualized for performance with large datasets
- Inline editing capabilities
- Advanced filtering and sorting
- Bulk actions support

### Split Editor
- Equal split mode with participant management
- Custom split mode with amount validation
- Real-time calculation preview
- Include/exclude self option

### Budget Overview
- Monthly budget tracking
- Visual progress indicators
- Category-wise breakdown charts
- Spend over time visualization

## Development

### Available Scripts
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

### Adding New Components
1. Create component in appropriate directory
2. Use shadcn/ui components when possible
3. Follow TypeScript best practices
4. Add proper error handling and loading states

### Styling Guidelines
- Use Tailwind CSS utility classes
- Follow the design system established by shadcn/ui
- Maintain consistent spacing and typography
- Use semantic color tokens

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | `http://localhost:8000` |
| `NEXT_PUBLIC_APP_ENV` | Application environment | `development` |

## Contributing

1. Follow the existing code structure and patterns
2. Use TypeScript for all new code
3. Write meaningful commit messages
4. Test your changes thoroughly
5. Update documentation as needed

## License

This project is part of the Expense Tracker application.