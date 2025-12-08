import React from 'react';
import { useBook } from '../contexts/BookContext';
import { Header } from '../components/layout/Header';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Clock, BookOpen, PenTool, Bot } from 'lucide-react';

export const ReportPage: React.FC = () => {
  const { stats, highlights } = useBook();

  // Prepare data for chart
  const data = Object.entries(stats.chapterVisits).map(([chapterId, visits]) => ({
    name: chapterId === 'ch1' ? 'Ch 1' : chapterId === 'ch2' ? 'Ch 2' : 'Ch 3',
    visits: visits
  }));

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    return `${mins}m ${seconds % 60}s`;
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
       {/* Use dummy toggle functions for Header since they aren't used here */}
      <Header toggleSidebar={() => {}} toggleNotes={() => {}} />
      
      <main className="pt-24 px-4 max-w-5xl mx-auto pb-20">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Learning Report</h1>
          <p className="text-slate-500 dark:text-slate-400">Analysis of your reading habits and engagement.</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard 
            icon={<Clock className="text-blue-500" />} 
            label="Reading Time" 
            value={formatTime(stats.totalReadingTime)} 
          />
          <StatCard 
            icon={<BookOpen className="text-green-500" />} 
            label="Chapters Read" 
            value={Object.keys(stats.chapterVisits).length.toString()} 
          />
          <StatCard 
            icon={<PenTool className="text-yellow-500" />} 
            label="Highlights" 
            value={highlights.length.toString()} 
          />
          <StatCard 
            icon={<Bot className="text-purple-500" />} 
            label="AI Interactions" 
            value={stats.aiInteractionCount.toString()} 
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Chapter Engagement Chart */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold mb-4 text-slate-800 dark:text-white">Chapter Engagement</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                    cursor={{fill: 'transparent'}}
                  />
                  <Bar dataKey="visits" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40}>
                    {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#3b82f6' : '#60a5fa'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-slate-400 mt-2">Number of times each chapter was opened</p>
          </div>

          {/* AI Summary Card (Simulated for MVP) */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold mb-4 text-slate-800 dark:text-white flex items-center gap-2">
              <Bot size={20} className="text-purple-500" />
              AI Learning Summary
            </h3>
            <div className="space-y-4">
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
                <h4 className="font-semibold text-purple-700 dark:text-purple-300 text-sm mb-2">Focus Areas</h4>
                <div className="flex flex-wrap gap-2">
                  {highlights.slice(0, 3).map((hl, i) => (
                    <span key={i} className="px-2 py-1 bg-white dark:bg-slate-800 text-xs rounded text-slate-600 dark:text-slate-300 shadow-sm border border-slate-100 dark:border-slate-700 truncate max-w-[150px]">
                      {hl.text}
                    </span>
                  ))}
                  {highlights.length === 0 && <span className="text-xs text-slate-400">No specific focus areas detected yet.</span>}
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold text-slate-700 dark:text-slate-300 text-sm mb-2">Reading Velocity</h4>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5">
                  <div className="bg-green-500 h-2.5 rounded-full" style={{ width: '65%' }}></div>
                </div>
                <p className="text-xs text-slate-400 mt-1">You are reading at a consistent pace.</p>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode, label: string, value: string }> = ({ icon, label, value }) => (
  <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center">
    <div className="mb-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-full">
      {icon}
    </div>
    <span className="text-2xl font-bold text-slate-800 dark:text-white block">{value}</span>
    <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</span>
  </div>
);
