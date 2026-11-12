import { Navbar } from './Navbar';
import { ToastContainer } from '../common/Toast';

export function PageLayout({ children, noPad = false }) {
  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <Navbar />
      <main className={`pt-14 ${noPad ? '' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'}`}>
        {children}
      </main>
      <ToastContainer />
    </div>
  );
}

