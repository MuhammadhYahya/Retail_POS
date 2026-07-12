import React from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Users, BarChart3, Settings } from 'lucide-react';

const MODULES = [
  {
    title: 'Staff Management',
    description: 'Create and manage cashier and admin accounts.',
    icon: Users,
    path: '/staff',
    available: true,
  },
  {
    title: 'Sales Reports',
    description: 'View sales analytics and daily summaries.',
    icon: BarChart3,
    path: null,
    available: false,
  },
  {
    title: 'Settings',
    description: 'Configure store preferences and system options.',
    icon: Settings,
    path: null,
    available: false,
  },
];

export default function AdminDashboard() {
  const navigate = useNavigate();

  return (
    <AppShell title="Admin Dashboard" description="Manage your POS system and team.">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((mod) => {
          const Icon = mod.icon;
          return (
            <Card
              key={mod.title}
              className={mod.available ? 'cursor-pointer hover:border-primary/50 transition-colors' : 'opacity-60'}
              onClick={() => mod.available && mod.path && navigate(mod.path)}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/15">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{mod.title}</CardTitle>
                </div>
                <CardDescription>{mod.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-xs text-muted-foreground">
                  {mod.available ? 'Click to open' : 'Coming soon'}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
