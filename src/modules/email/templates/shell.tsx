import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import { styles } from "@/modules/email/templates/styles";

/**
 * The outer chrome every template shares: document, preview text, page
 * background, and the white card the content sits on.
 *
 * Extracted because all three notifications are the same envelope around
 * different copy, and the alternative is three copies of an eight-element
 * nesting that must stay identical for the mails to look like one product.
 *
 * `preview` is the snippet clients show beside the subject in the inbox list.
 * Left unset it falls back to the first words of the body, which for these
 * templates is "Hi <name>," — the least informative sentence in the mail.
 */
export function EmailShell({
  preview,
  heading,
  lead,
  children,
}: {
  preview: string;
  heading: string;
  /** The one-line summary under the heading. */
  lead: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{heading}</Heading>
          <Text style={styles.lead}>{lead}</Text>
          {children}
        </Container>
      </Body>
    </Html>
  );
}
