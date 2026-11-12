import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ZoomIn, ZoomOut, RotateCcw, Filter, Info, X, ArrowRight } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout';
import { RiskBadge } from '../components/common/RiskBadge';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { MaskedValue } from '../components/common/MaskedValue';
import { DisclaimerBox } from '../components/common/DisclaimerBox';
import { getTrustGraph, getSubgraph, explainReportConnection } from '../services/mockApi';
import { calculateNodePositions, NODE_COLORS, EDGE_STYLES } from '../services/graphService';
import { useAuth } from '../contexts/AuthContext';

const CANVAS_W = 960;
const CANVAS_H = 620;

function NodeLegend() {
  const entries = [
    { type: 'report', label: 'Report' },
    { type: 'upi', label: 'UPI ID' },
    { type: 'phone', label: 'Phone' },
    { type: 'email', label: 'Email' },
    { type: 'domain', label: 'Domain' },
    { type: 'bank_account', label: 'Bank Account' },
  ];
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-[#6b6460] uppercase tracking-wider">Node Types</h3>
      <div className="space-y-2">
        {entries.map(e => (
          <div key={e.type} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: NODE_COLORS[e.type] }} />
            <span className="text-sm text-[#a09890]">{e.label}</span>
          </div>
        ))}
      </div>
      <div className="pt-3 border-t border-[#2f2f2f] space-y-2">
        <h3 className="text-xs font-semibold text-[#6b6460] uppercase tracking-wider">Edge Confidence</h3>
        {[
          { dash: 'none', label: 'High' },
          { dash: '8 4', label: 'Medium' },
          { dash: '3 3', label: 'Low' },
        ].map(e => (
          <div key={e.label} className="flex items-center gap-2">
            <svg width="32" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="32" y2="5"
                stroke="#a09890" strokeWidth="1.5"
                strokeDasharray={e.dash === 'none' ? undefined : e.dash} />
            </svg>
            <span className="text-sm text-[#a09890]">{e.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IdentifierDetail({ node, userRole }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: NODE_COLORS[node.type] }} />
        <span className="text-xs font-semibold text-[#6b6460] uppercase tracking-wider">{node.type.replace('_', ' ')}</span>
      </div>
      <div className="bg-[#1c1c1c] rounded-lg p-3 font-mono text-sm break-all">
        <MaskedValue
          type={node.type}
          value={node.data?.value || node.fullLabel}
          userRole={userRole}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-[#1c1c1c] rounded p-2">
          <p className="text-[#6b6460] text-xs">Reports</p>
          <p className="text-[#f0ede8] font-semibold">{node.reportCount ?? node.data?.reportIds?.length ?? '—'}</p>
        </div>
        <div className="bg-[#1c1c1c] rounded p-2">
          <p className="text-[#6b6460] text-xs">Risk Score</p>
          <p className="text-[#f0ede8] font-semibold">{node.riskScore ?? '—'}</p>
        </div>
      </div>
      {node.data?.notes && (
        <p className="text-xs text-[#a09890] leading-relaxed">{node.data.notes}</p>
      )}
      {node.data?.reportIds?.length > 0 && (
        <div>
          <p className="text-xs text-[#6b6460] mb-1.5">Linked Reports</p>
          <div className="flex flex-wrap gap-1">
            {node.data.reportIds.map(rid => (
              <Link key={rid} to={`/reports/${rid}`}
                className="text-xs px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded hover:bg-amber-500/20 transition-colors">
                {rid}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportDetail({ node, _selectedNode, secondNode, onSelectSecond, onExplain, explainResult, explainLoading }) {
  const r = node.data;
  const hasSecond = !!secondNode;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ background: NODE_COLORS.report }} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#f0ede8] leading-tight">{r?.companyName || node.label}</p>
          {r?.title && <p className="text-xs text-[#6b6460] mt-0.5 leading-snug">{r.title}</p>}
        </div>
      </div>
      {r && (
        <RiskBadge score={r.riskScore} category={r.riskCategory} />
      )}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-[#1c1c1c] rounded p-2">
          <p className="text-[#6b6460] text-xs">Status</p>
          <p className="text-[#f0ede8] capitalize font-medium">{r?.status || '—'}</p>
        </div>
        <div className="bg-[#1c1c1c] rounded p-2">
          <p className="text-[#6b6460] text-xs">Identifiers</p>
          <p className="text-[#f0ede8] font-semibold">{r?.identifierIds?.length ?? '—'}</p>
        </div>
      </div>
      {r?.clusterIds?.length > 0 && (
        <div>
          <p className="text-xs text-[#6b6460] mb-1">Clusters</p>
          <div className="flex flex-wrap gap-1">
            {r.clusterIds.map(c => (
              <span key={c} className="text-xs px-2 py-0.5 bg-[#1c1c1c] border border-[#2f2f2f] text-[#a09890] rounded">{c}</span>
            ))}
          </div>
        </div>
      )}
      <Link to={`/reports/${node.id}`}
        className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors">
        View full report <ArrowRight size={12} />
      </Link>

      {/* "Why connected?" second node selection */}
      <div className="border-t border-[#2f2f2f] pt-3">
        {!hasSecond || secondNode?.id === node.id ? (
          <button
            onClick={() => onSelectSecond(node)}
            className="w-full text-xs text-[#a09890] hover:text-[#f0ede8] border border-[#3a3a3a] hover:border-[#4a4a4a] rounded px-2 py-1.5 transition-colors cursor-pointer"
          >
            {secondNode?.id === node.id ? '✓ Selected as second report' : 'Select to explain connection…'}
          </button>
        ) : (
          <button
            onClick={onExplain}
            disabled={explainLoading}
            className="w-full text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 rounded px-2 py-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            {explainLoading ? 'Analysing…' : `Why connected to ${secondNode.data?.companyName || secondNode.label}?`}
          </button>
        )}
      </div>

      {explainResult && (
        <div className={`rounded-lg p-3 border text-xs leading-relaxed ${
          explainResult.type === 'direct' ? 'bg-orange-500/10 border-orange-500/20 text-orange-200' :
          explainResult.type === 'indirect' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-200' :
          'bg-[#1c1c1c] border-[#2f2f2f] text-[#a09890]'
        }`}>
          <p className="font-semibold mb-1 capitalize">{explainResult.type} connection
            {explainResult.confidence && ` · ${explainResult.confidence} confidence`}
          </p>
          <p>{explainResult.explanation}</p>
        </div>
      )}
    </div>
  );
}

export default function TrustGraphPage() {
  const { user } = useAuth();
  const userRole = user?.role || 'student';

  const [graphData, setGraphData] = useState(null);
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedNode, setSelectedNode] = useState(null);
  const [secondNode, setSecondNode] = useState(null);
  const [subgraphMode, setSubgraphMode] = useState(null); // null = full graph, nodeId = subgraph
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [explainResult, setExplainResult] = useState(null);
  const [explainLoading, setExplainLoading] = useState(false);

  const svgRef = useRef(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTrustGraph({ flaggedOnly });
      const pos = calculateNodePositions(data.nodes, CANVAS_W, CANVAS_H);
      setGraphData(data);
      setPositions(pos);
    } catch {
      setError('Failed to load trust graph. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [flaggedOnly]);

  useEffect(() => {
    loadGraph();
    setSelectedNode(null);
    setSecondNode(null);
    setSubgraphMode(null);
    setExplainResult(null);
  }, [loadGraph]);

  const handleNodeClick = useCallback(async (node) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
      return;
    }
    setSelectedNode(node);
    setExplainResult(null);
  }, [selectedNode]);

  const handleExploreSubgraph = useCallback(async (nodeId) => {
    setLoading(true);
    try {
      const sub = await getSubgraph(nodeId, 2);
      const pos = calculateNodePositions(sub.nodes, CANVAS_W, CANVAS_H);
      setGraphData(sub);
      setPositions(pos);
      setSubgraphMode(nodeId);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const handleExplain = useCallback(async () => {
    if (!selectedNode || !secondNode || selectedNode.type !== 'report' || secondNode.type !== 'report') return;
    setExplainLoading(true);
    try {
      const result = await explainReportConnection(selectedNode.id, secondNode.id);
      setExplainResult(result);
    } finally {
      setExplainLoading(false);
    }
  }, [selectedNode, secondNode]);

  const resetView = () => {
    setSubgraphMode(null);
    setSelectedNode(null);
    setSecondNode(null);
    setExplainResult(null);
    setZoom(1);
    loadGraph();
  };

  const viewBox = `${((1 - zoom) * CANVAS_W) / 2} ${((1 - zoom) * CANVAS_H) / 2} ${CANVAS_W / zoom} ${CANVAS_H / zoom}`;

  const nodes = graphData?.nodes || [];
  const edges = graphData?.edges || [];

  return (
    <PageLayout noPad>
      <div className="flex flex-col h-[calc(100vh-56px)]">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-[#2f2f2f] bg-[#161616] flex-wrap gap-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-[#f0ede8]">Trust Graph</h1>
            {graphData && (
              <span className="text-xs text-[#6b6460]">
                {nodes.length} nodes · {edges.length} edges
                {subgraphMode && <span className="ml-2 text-amber-400">· Subgraph view</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)}
                className="accent-amber-500 w-3.5 h-3.5" />
              <span className="text-xs text-[#a09890]"><Filter size={10} className="inline mr-0.5" />Flagged only</span>
            </label>
            <div className="flex items-center gap-1 border border-[#3a3a3a] rounded-lg overflow-hidden">
              <button onClick={() => setZoom(z => Math.min(z + 0.25, 2.5))}
                className="px-2 py-1 text-[#a09890] hover:text-[#f0ede8] hover:bg-[#232323] transition-colors cursor-pointer"
                title="Zoom in"><ZoomIn size={14} /></button>
              <span className="px-1.5 text-xs text-[#6b6460]">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}
                className="px-2 py-1 text-[#a09890] hover:text-[#f0ede8] hover:bg-[#232323] transition-colors cursor-pointer"
                title="Zoom out"><ZoomOut size={14} /></button>
            </div>
            <button onClick={resetView}
              className="flex items-center gap-1 px-2 py-1 text-xs text-[#a09890] hover:text-[#f0ede8] border border-[#3a3a3a] rounded-lg hover:bg-[#232323] transition-colors cursor-pointer">
              <RotateCcw size={12} /> Reset
            </button>
          </div>
        </div>

        {/* Main area */}
        <div className="flex flex-1 overflow-hidden">
          {/* SVG Canvas */}
          <div className="flex-1 relative overflow-hidden bg-[#0f0f0f]">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <LoadingSpinner size="lg" />
              </div>
            ) : error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <p className="text-[#a09890]">{error}</p>
                <button onClick={loadGraph} className="text-amber-400 text-sm hover:underline cursor-pointer">
                  Try again
                </button>
              </div>
            ) : nodes.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <p className="text-[#6b6460]">No shared identifiers found{flaggedOnly ? ' (flagged only)' : ''}.</p>
                {flaggedOnly && (
                  <button onClick={() => setFlaggedOnly(false)} className="text-amber-400 text-sm hover:underline cursor-pointer">
                    Show all
                  </button>
                )}
              </div>
            ) : (
              <svg
                ref={svgRef}
                viewBox={viewBox}
                className="w-full h-full"
                style={{ cursor: 'default' }}
              >
                <defs>
                  <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="node-glow-selected" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>

                {/* Edges */}
                <g>
                  {edges.map(edge => {
                    const src = positions[edge.source];
                    const tgt = positions[edge.target];
                    if (!src || !tgt) return null;
                    const style = EDGE_STYLES[edge.confidence] || EDGE_STYLES.medium;
                    const isActive = selectedNode &&
                      (edge.source === selectedNode.id || edge.target === selectedNode.id);
                    return (
                      <line
                        key={edge.id}
                        x1={src.x} y1={src.y}
                        x2={tgt.x} y2={tgt.y}
                        stroke={isActive ? '#f59e0b' : '#3a3a3a'}
                        strokeWidth={isActive ? 1.5 : 1}
                        strokeDasharray={style.strokeDasharray === 'none' ? undefined : style.strokeDasharray}
                        opacity={isActive ? 0.8 : 0.4}
                      />
                    );
                  })}
                </g>

                {/* Nodes */}
                <g>
                  {nodes.map(node => {
                    const pos = positions[node.id];
                    if (!pos) return null;
                    const isSelected = selectedNode?.id === node.id;
                    const isSecond = secondNode?.id === node.id;
                    const r = node.type === 'report' ? 16 : 12;
                    const color = NODE_COLORS[node.type] || '#888';
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${pos.x},${pos.y})`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleNodeClick(node)}
                      >
                        {/* Selection ring */}
                        {(isSelected || isSecond) && (
                          <circle r={r + 6}
                            fill="none"
                            stroke={isSecond ? '#8b5cf6' : '#f59e0b'}
                            strokeWidth="2"
                            opacity="0.7"
                            filter="url(#node-glow-selected)"
                          />
                        )}
                        {/* Flagged ring */}
                        {node.flagged && !isSelected && (
                          <circle r={r + 4}
                            fill="none"
                            stroke="#ef4444"
                            strokeWidth="1"
                            strokeDasharray="3 3"
                            opacity="0.5"
                          />
                        )}
                        <circle
                          r={r}
                          fill={color}
                          opacity={0.9}
                          filter={isSelected ? 'url(#node-glow-selected)' : undefined}
                        />
                        {/* Label */}
                        <text
                          y={r + 14}
                          textAnchor="middle"
                          fill="#a09890"
                          fontSize="10"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {node.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            )}
          </div>

          {/* Right Panel */}
          <div className="w-64 shrink-0 border-l border-[#2f2f2f] bg-[#161616] flex flex-col overflow-y-auto">
            <div className="p-4 flex-1">
              {selectedNode ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#6b6460] uppercase tracking-wider">Selected Node</span>
                    <button onClick={() => { setSelectedNode(null); setExplainResult(null); }}
                      className="text-[#6b6460] hover:text-[#a09890] cursor-pointer">
                      <X size={14} />
                    </button>
                  </div>

                  {selectedNode.type === 'report' ? (
                    <ReportDetail
                      node={selectedNode}
                      selectedNode={selectedNode}
                      secondNode={secondNode}
                      onSelectSecond={(n) => {
                        if (secondNode?.id === n.id) setSecondNode(null);
                        else setSecondNode(n);
                        setExplainResult(null);
                      }}
                      onExplain={handleExplain}
                      explainResult={explainResult}
                      explainLoading={explainLoading}
                    />
                  ) : (
                    <IdentifierDetail node={selectedNode} userRole={userRole} />
                  )}

                  {selectedNode.type === 'report' && (
                    <div className="mt-3 pt-3 border-t border-[#2f2f2f]">
                      <button
                        onClick={() => handleExploreSubgraph(selectedNode.id)}
                        className="w-full text-xs bg-[#1c1c1c] hover:bg-[#232323] text-[#f0ede8] border border-[#3a3a3a] rounded px-2 py-1.5 transition-colors cursor-pointer"
                      >
                        Explore connections (2 hops)
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-1.5 mb-3">
                    <Info size={12} className="text-[#6b6460]" />
                    <span className="text-xs font-semibold text-[#6b6460] uppercase tracking-wider">Legend</span>
                  </div>
                  <NodeLegend />
                  <div className="mt-4 pt-4 border-t border-[#2f2f2f]">
                    <p className="text-xs text-[#6b6460] leading-relaxed">
                      Click any node to view details. Select two report nodes to explain their connection. Use "Explore connections" to focus on a subgraph.
                    </p>
                  </div>
                </div>
              )}
            </div>
            {/* Second node indicator */}
            {secondNode && (
              <div className="p-3 border-t border-[#2f2f2f] bg-purple-500/5">
                <p className="text-xs text-[#6b6460] mb-1">Second report selected:</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-purple-300 font-medium truncate">{secondNode.data?.companyName || secondNode.label}</span>
                  <button onClick={() => { setSecondNode(null); setExplainResult(null); }}
                    className="text-[#6b6460] hover:text-[#a09890] ml-2 cursor-pointer">
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Disclaimer bar */}
        <div className="px-4 py-2 border-t border-[#2f2f2f] bg-[#161616]">
          <DisclaimerBox compact />
        </div>
      </div>
    </PageLayout>
  );
}

