"use client";

import { motion } from "framer-motion";
import styles from "@/app/public-sections.module.css";

type PublicFaq = { id: string; question: string; answer: string };

export default function FAQClient({ initialFaqs }: { initialFaqs: PublicFaq[] }) {
  return (
    <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .04 } } }} className={styles.faqList}>
      {initialFaqs.map((faq, index) => (
        <motion.details key={faq.id} variants={{ hidden: { y: 12, opacity: 0 }, show: { y: 0, opacity: 1 } }} className={styles.faqItem} open={index === 0}>
          <summary><span>{faq.question}</span><i>+</i></summary>
          <div className={styles.faqAnswer}>{faq.answer}</div>
        </motion.details>
      ))}
    </motion.div>
  );
}
